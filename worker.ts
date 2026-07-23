/* WhatsApp Web worker: each active account owns one isolated Chromium profile. */
import "dotenv/config";
import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import whatsappWeb from "whatsapp-web.js";
import type { Client as WhatsAppWebClient, Contact, Message } from "whatsapp-web.js";
import { WhatsAppBridgeType, WhatsAppConnectionStatus } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { auditConnection, updateConnection } from "./lib/whatsapp/connection";
import { maskPhone, normalizeWebMessage, type WebMessageLike } from "./lib/whatsapp/normalize-web-message";
import { persistMessage, upsertContact } from "./lib/whatsapp/persistence";
import { refreshContactProfilePicture, refreshRecentContactProfilePictures } from "./lib/whatsapp/profile-picture";
import { attachOutboundExternalId, cancelOutboundDelivery, cancelOutboundRequest, claimNextOutboundRequest, completeOutboundRequest, failStaleOutboundRequests, recordOutboundRelayAccepted } from "./lib/whatsapp/outbound";
import { resolveOutboundDestination } from "./lib/whatsapp/outbound-destination";
import { processMediaAttachment, recoverPendingMedia } from "./lib/whatsapp/web-media";
import { claimNextReadReceiptRequest, completeReadReceiptRequest, failReadReceiptRequest } from "./lib/whatsapp/read-receipts";
import { TransientPresenceManager } from "./lib/whatsapp/transient-presence";
import { canDispatchOutbound } from "./lib/whatsapp/outbound-safety";
import { changedChatWatermarks, seedChatWatermarks } from "./lib/whatsapp/inbound-reconciliation";
import { operationalLog, safeErrorInfo, safeLogRef } from "./lib/operational-log";

const { Client, LocalAuth, MessageAck } = whatsappWeb;
const authRoot = process.env.WA_WEB_AUTH_DIR || "/data/wwebjs-auth";
const readyTimeoutMs = Math.max(30_000, Number(process.env.WA_WEB_CLIENT_READY_TIMEOUT_SECONDS ?? 120) * 1_000);
// `authenticated` is deliberately emitted by whatsapp-web.js before it injects
// its public page helpers and emits `ready`. Do not call public chat APIs in
// that interval: on some current WhatsApp Web builds that races the injector.
const readinessProbeDelayMs = Math.min(
  Math.max(5_000, Number(process.env.WA_WEB_READY_PROBE_DELAY_SECONDS ?? 25) * 1_000),
  Math.max(5_000, readyTimeoutMs - 5_000),
);
const accountCheckMs = Math.max(5_000, Number(process.env.WA_ACCOUNT_CHECK_SECONDS ?? 15) * 1_000);
const inboundReconcileMs = Math.max(10_000, Number(process.env.WA_WEB_INBOUND_RECONCILE_SECONDS ?? 30) * 1_000);
const inboundReconcileLimit = Math.max(1, Math.min(100, Number(process.env.WA_WEB_INBOUND_RECONCILE_LIMIT ?? 25)));
const clients = new Map<string, WhatsAppWebClient>();
const readyAccounts = new Set<string>();
const authenticatedAccounts = new Set<string>();
const connecting = new Set<string>();
const accountQueues = new Map<string, Promise<void>>();
const outboundWorkQueued = new Set<string>();
const outboundDeferrals = new Map<string, { reason: string; loggedAt: number }>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const reconnectAttempts = new Map<string, number>();
const readyTimers = new Map<string, ReturnType<typeof setTimeout>>();
const readinessProbeTimers = new Map<string, ReturnType<typeof setInterval>>();
const browserDiagnosticsAttached = new WeakSet<object>();
const inboundWatermarks = new Map<string, Map<string, number>>();
const inboundStartedAt = new Map<string, Date>();
const inboundReconcileFailures = new Map<string, number>();
const inboundReconciliationDisabled = new Set<string>();
let stopping = false;
let outboundTimer: ReturnType<typeof setInterval> | undefined;
let mediaTimer: ReturnType<typeof setInterval> | undefined;
let readTimer: ReturnType<typeof setInterval> | undefined;
let staleTimer: ReturnType<typeof setInterval> | undefined;
let inboundReconcileTimer: ReturnType<typeof setInterval> | undefined;

const presence = new TransientPresenceManager(3_000, (accountId, error) => {
  operationalLog("presence.update_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "debug");
});

function clientId(accountId: string) { return accountId.replace(/[^a-zA-Z0-9_-]/g, "_"); }
function profilePath(accountId: string) { return join(authRoot, `session-${clientId(accountId)}`); }
function hasProfile(accountId: string) { return access(profilePath(accountId)).then(() => true).catch(() => false); }
function chromiumArgs() {
  const args = ["--disable-dev-shm-usage", "--disable-gpu"];
  // Railway's container runtime does not permit Chromium's namespace sandbox.
  // This flag is opt-in, documented and only enabled by the production image.
  if (process.env.PUPPETEER_NO_SANDBOX === "true") args.push("--no-sandbox", "--disable-setuid-sandbox");
  return args;
}

function clearReadyTimer(accountId: string) {
  const timer = readyTimers.get(accountId);
  if (timer) clearTimeout(timer);
  readyTimers.delete(accountId);
}

function clearReadinessProbe(accountId: string) {
  const timer = readinessProbeTimers.get(accountId);
  if (timer) clearInterval(timer);
  readinessProbeTimers.delete(accountId);
}

function safeConnectionState(state: unknown) {
  return typeof state === "string" && /^[A-Z_]{1,64}$/.test(state) ? state : "UNKNOWN";
}

function attachBrowserDiagnostics(accountId: string, client: WhatsAppWebClient) {
  const page = client.pupPage;
  if (!page || browserDiagnosticsAttached.has(page)) return;
  browserDiagnosticsAttached.add(page);
  page.on("pageerror", (error) => operationalLog("connection.browser_page_error", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error"));
  page.on("error", (error) => operationalLog("connection.browser_error", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error"));
  page.on("console", (message) => {
    const type = message.type();
    // Browser output can contain chat data. Keep only a one-way fingerprint so
    // a recurring injector failure is diagnosable in Railway without leaking it.
    if (type === "error" || type === "warn") operationalLog("connection.browser_console", { account: safeLogRef(accountId), consoleType: type, consoleFingerprint: safeLogRef(message.text()) }, "error");
  });
}

async function completeClientReady(accountId: string, client: WhatsAppWebClient, source: "ready_event" | "state_probe") {
  if (clients.get(accountId) !== client || readyAccounts.has(accountId) || !(await isAccountActive(accountId))) return false;
  // A `ready` event is emitted only after whatsapp-web.js has attached its
  // public message listeners. `getChats()` serializes every cached chat and
  // can fail because of one malformed/unsupported chat (often a group); that
  // optional reconciliation API must never prevent realtime reception.
  // Without `ready`, however, a CONNECTED socket alone does not prove that
  // those listeners exist, so the compatibility state probe remains strict.
  if (source === "state_probe" && !(await primeInboundReconciliation(accountId, client))) {
    operationalLog("connection.inbound_api_unavailable", { account: safeLogRef(accountId), source }, "error");
    return false;
  }
  readyAccounts.add(accountId);
  clearReadyTimer(accountId);
  clearReadinessProbe(accountId);
  resetReconnectDelay(accountId);
  const accountIdFromClient = client.info?.wid?._serialized ?? null;
  await updateConnection(accountId, { status: WhatsAppConnectionStatus.CONNECTED, qrCode: null, qrExpiresAt: null, accountJid: accountIdFromClient, maskedPhone: maskPhone(accountIdFromClient), lastError: null, bridgeType: WhatsAppBridgeType.WWEBJS });
  await auditConnection(accountId, source === "ready_event" ? "WHATSAPP_CONNECTED" : "WHATSAPP_CONNECTED_STATE_VERIFIED");
  await presence.markIdle(accountId, client);
  operationalLog("connection.open", { account: safeLogRef(accountId), source });
  // Baseline reconciliation is best-effort after a real ready event. It is a
  // recovery aid only; incoming `message` events are already wired above.
  if (source === "ready_event") void primeInboundReconciliation(accountId, client);
  schedulePostReadyMaintenance(accountId, client);
  return true;
}

function chatSnapshots(chats: Awaited<ReturnType<WhatsAppWebClient["getChats"]>>) {
  return chats.flatMap((chat) => {
    const id = chat.id?._serialized;
    const timestamp = typeof chat.timestamp === "number" && Number.isSafeInteger(chat.timestamp) ? chat.timestamp : null;
    return id && timestamp !== null ? [{ id, timestamp }] : [];
  });
}

async function primeInboundReconciliation(accountId: string, client: WhatsAppWebClient) {
  try {
    const chats = await client.getChats();
    inboundWatermarks.set(accountId, seedChatWatermarks(chatSnapshots(chats)));
    inboundStartedAt.set(accountId, new Date());
    inboundReconcileFailures.delete(accountId);
    inboundReconciliationDisabled.delete(accountId);
    operationalLog("inbound.reconcile_primed", { account: safeLogRef(accountId), chats: chats.length });
    return true;
  } catch (error) {
    const failures = (inboundReconcileFailures.get(accountId) ?? 0) + 1;
    inboundReconcileFailures.set(accountId, failures);
    operationalLog(
      "inbound.reconcile_unavailable",
      { account: safeLogRef(accountId), failures, ...safeErrorInfo(error) },
      failures === 1 || failures % 6 === 0 ? "error" : "debug",
    );
    if (failures >= 3) {
      inboundReconciliationDisabled.add(accountId);
      operationalLog("inbound.reconcile_disabled", { account: safeLogRef(accountId), failures, reason: "PUBLIC_CHAT_API_UNAVAILABLE" }, "error");
    }
    return false;
  }
}

/**
 * Contact/profile reconciliation can be expensive for established accounts.
 * It must never occupy the per-account event queue: WhatsApp Web delivers
 * incoming messages through that same queue immediately after readiness.
 */
function schedulePostReadyMaintenance(accountId: string, client: WhatsAppWebClient) {
  void (async () => {
    operationalLog("connection.maintenance_started", { account: safeLogRef(accountId) });
    try {
      await syncKnownContacts(accountId, client);
      await refreshRecentContactProfilePictures(accountId, client);
      await recoverPendingMedia(accountId, client);
      operationalLog("connection.maintenance_completed", { account: safeLogRef(accountId) });
    } catch (error) {
      operationalLog("connection.maintenance_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error");
    }
  })();
}

function startReadinessProbe(accountId: string, client: WhatsAppWebClient) {
  clearReadinessProbe(accountId);
  let attempts = 0;
  let webVersionLogged = false;
  const probe = () => void enqueueAccountWork(accountId, async () => {
    if (clients.get(accountId) !== client || readyAccounts.has(accountId) || !authenticatedAccounts.has(accountId)) return clearReadinessProbe(accountId);
    attempts += 1;
    try {
      attachBrowserDiagnostics(accountId, client);
      if (!webVersionLogged) {
        webVersionLogged = true;
        try {
          const version = await client.getWWebVersion();
          operationalLog("connection.web_version", { account: safeLogRef(accountId), version: typeof version === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(version) ? version : "unknown" });
        } catch (error) {
          operationalLog("connection.web_version_unavailable", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "debug");
        }
      }
      const state = safeConnectionState(await client.getState());
      operationalLog("connection.state_probe", { account: safeLogRef(accountId), state, attempt: attempts }, attempts === 1 || attempts % 6 === 0 ? "info" : "debug");
      if (state === "CONNECTED") {
        operationalLog("connection.ready_recovered_from_state", { account: safeLogRef(accountId) });
        await completeClientReady(accountId, client, "state_probe");
      }
    } catch (error) {
      operationalLog(
        "connection.state_probe_failed",
        { account: safeLogRef(accountId), attempt: attempts, ...safeErrorInfo(error) },
        attempts === 1 || attempts % 6 === 0 ? "error" : "debug",
      );
    }
  });
  // whatsapp-web.js emits `authenticated` before LoadUtils and its event
  // listeners are installed. Leave that documented initialization path alone
  // first; this is solely a delayed compatibility fallback when `ready` never
  // arrives. It is intentionally not a recurring WhatsApp sync.
  operationalLog("connection.readiness_probe_scheduled", { account: safeLogRef(accountId), delayMs: readinessProbeDelayMs }, "debug");
  readinessProbeTimers.set(accountId, setTimeout(() => {
    readinessProbeTimers.delete(accountId);
    probe();
    readinessProbeTimers.set(accountId, setInterval(probe, 5_000));
  }, readinessProbeDelayMs));
}

function waitForReady(accountId: string, client: WhatsAppWebClient) {
  clearReadyTimer(accountId);
  readyTimers.set(accountId, setTimeout(() => void enqueueAccountWork(accountId, async () => {
    readyTimers.delete(accountId);
    if (clients.get(accountId) !== client || readyAccounts.has(accountId)) return;
    await updateConnection(accountId, {
      status: WhatsAppConnectionStatus.ERROR,
      qrCode: null,
      qrExpiresAt: null,
      lastError: "La vinculación fue aceptada, pero WhatsApp Web no terminó de iniciar. Revisa los logs del worker y vuelve a intentarlo si persiste.",
      bridgeType: WhatsAppBridgeType.WWEBJS,
    });
    operationalLog("connection.ready_timeout", { account: safeLogRef(accountId) }, "error");
    // A bare Chromium session that never exposes the documented client APIs
    // cannot receive messages reliably. Destroy it while preserving LocalAuth
    // and retry with backoff instead of showing a false CONNECTED state.
    await closeClient(accountId, client);
    if (!stopping && await isAccountActive(accountId)) scheduleReconnect(accountId);
  }), readyTimeoutMs));
}

function enqueueAccountWork(accountId: string, work: () => Promise<void>) {
  const previous = accountQueues.get(accountId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work).catch((error) => operationalLog("worker.account_work_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error"));
  accountQueues.set(accountId, next);
  return next;
}

function startQueueProcessors() {
  if (outboundTimer) return;
  outboundTimer = setInterval(() => void processOutbound(), 1_500);
  mediaTimer = setInterval(() => void processPendingMedia(), 10_000);
  readTimer = setInterval(() => void processReadReceipts(), 2_000);
  staleTimer = setInterval(() => void processStaleOutboundRequests(), 60_000);
  inboundReconcileTimer = setInterval(() => void processInboundReconciliation(), inboundReconcileMs);
  void processStaleOutboundRequests();
}

function stopQueueProcessorsIfIdle() {
  if (clients.size) return;
  if (outboundTimer) clearInterval(outboundTimer);
  if (mediaTimer) clearInterval(mediaTimer);
  if (readTimer) clearInterval(readTimer);
  if (staleTimer) clearInterval(staleTimer);
  if (inboundReconcileTimer) clearInterval(inboundReconcileTimer);
  outboundTimer = mediaTimer = readTimer = staleTimer = inboundReconcileTimer = undefined;
}

async function isAccountActive(accountId: string) {
  return Boolean(await prisma.whatsAppAccount.findFirst({ where: { id: accountId, isActive: true }, select: { id: true } }));
}

function resetReconnectDelay(accountId: string) {
  reconnectAttempts.delete(accountId);
  const timer = reconnectTimers.get(accountId);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(accountId);
}

function scheduleReconnect(accountId: string) {
  if (stopping || reconnectTimers.has(accountId) || clients.has(accountId)) return;
  const attempt = Math.min(reconnectAttempts.get(accountId) ?? 0, 6);
  const delayMs = Math.min(5_000 * 2 ** attempt, 60_000);
  reconnectAttempts.set(accountId, attempt + 1);
  reconnectTimers.set(accountId, setTimeout(() => { reconnectTimers.delete(accountId); void connect(accountId); }, delayMs));
  operationalLog("connection.reconnect_scheduled", { account: safeLogRef(accountId), attempt: attempt + 1, delayMs }, "debug");
}

async function closeClient(accountId: string, client?: WhatsAppWebClient) {
  const active = client ?? clients.get(accountId);
  if (!active) {
    readyAccounts.delete(accountId);
    authenticatedAccounts.delete(accountId);
    inboundWatermarks.delete(accountId);
    inboundStartedAt.delete(accountId);
    inboundReconcileFailures.delete(accountId);
    inboundReconciliationDisabled.delete(accountId);
    clearReadyTimer(accountId);
    clearReadinessProbe(accountId);
    return;
  }
  if (clients.get(accountId) === active) clients.delete(accountId);
  readyAccounts.delete(accountId);
  authenticatedAccounts.delete(accountId);
  inboundWatermarks.delete(accountId);
  inboundStartedAt.delete(accountId);
  inboundReconcileFailures.delete(accountId);
  inboundReconciliationDisabled.delete(accountId);
  clearReadyTimer(accountId);
  clearReadinessProbe(accountId);
  await presence.dispose(accountId, active);
  try { await active.destroy(); } catch { /* Browser can already be gone. */ }
  stopQueueProcessorsIfIdle();
}

async function contactFromMessage(accountId: string, message: Message) {
  try {
    const contact = await message.getContact();
    const chatId = contact.id?._serialized;
    if (chatId) await upsertContact(accountId, { chatId, displayName: contact.name ?? contact.shortName ?? null, pushName: contact.pushname ?? null });
  } catch {
    // Contact metadata is optional and must never block a message.
  }
}

async function persistInboundMessageEvent(accountId: string, client: WhatsAppWebClient, raw: Message, source: "message" | "message_create" | "reconcile") {
  const eventExternalId = raw.id?._serialized ?? raw.id?.id ?? "unknown";
  const eventType = typeof raw.type === "string" && /^[a-z_]{1,64}$/i.test(raw.type) ? raw.type : "unknown";
  operationalLog("inbound.event_received", { account: safeLogRef(accountId), message: safeLogRef(eventExternalId), messageType: eventType, source });
  const message = normalizeWebMessage(raw as unknown as WebMessageLike);
  if (!message || message.direction !== "INBOUND") {
    operationalLog("inbound.event_ignored", { account: safeLogRef(accountId), message: safeLogRef(eventExternalId), reason: "unsupported_or_outbound", source }, "debug");
    return;
  }
  await contactFromMessage(accountId, raw);
  const persisted = await presence.duringActivity(accountId, client, () => persistMessage(accountId, message));
  // Both public events can be emitted for the same inbound message. Only the
  // creator owns its media transfer and contact refresh; PostgreSQL enforces
  // the message-level deduplication for all subsequent events.
  if (persisted.created && persisted.mediaAttachment) await processMediaAttachment(accountId, persisted.mediaAttachment.id, client, raw);
  if (persisted.created && message.conversationType === "DIRECT") await refreshContactProfilePicture(accountId, client, message.conversationJid);
  operationalLog("inbound.persisted", { account: safeLogRef(accountId), message: safeLogRef(message.externalId), created: persisted.created, source });
}

async function syncKnownContacts(accountId: string, client: WhatsAppWebClient) {
  try {
    const contacts = await client.getContacts();
    for (const contact of contacts.slice(0, 5_000)) {
      const chatId = contact.id?._serialized;
      if (chatId) await upsertContact(accountId, { chatId, displayName: contact.name ?? contact.shortName ?? null, pushName: contact.pushname ?? null });
    }
    operationalLog("contacts.sync_completed", { account: safeLogRef(accountId), count: contacts.length });
  } catch (error) {
    operationalLog("contacts.sync_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error");
  }
}

async function connect(accountId: string) {
  if (stopping || connecting.has(accountId) || clients.has(accountId) || !(await isAccountActive(accountId))) return;
  connecting.add(accountId);
  let client: WhatsAppWebClient | undefined;
  try {
    await mkdir(authRoot, { recursive: true });
    operationalLog("connection.connecting", { account: safeLogRef(accountId) });
    await updateConnection(accountId, { status: WhatsAppConnectionStatus.CONNECTING, qrCode: null, qrExpiresAt: null, lastError: null, bridgeType: WhatsAppBridgeType.WWEBJS });
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: authRoot, clientId: clientId(accountId) }),
      authTimeoutMs: readyTimeoutMs,
      qrMaxRetries: 0,
      takeoverOnConflict: false,
      deviceName: "WhatsAppBusiness",
      browserName: "Chrome",
      // Do not persist a captured WhatsApp Web HTML document inside the
      // container. A stale cached build can keep a known injector defect alive
      // across worker restarts. Chromium still retains only the authenticated
      // LocalAuth profile under /data/wwebjs-auth.
      webVersionCache: { type: "none" },
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: chromiumArgs(),
      },
    });
    clients.set(accountId, client);
    startQueueProcessors();
    operationalLog("connection.browser_created", { account: safeLogRef(accountId) });
    const activeClient = client;
    activeClient.on("qr", (qr) => void enqueueAccountWork(accountId, async () => {
      if (clients.get(accountId) !== activeClient) return;
      if (authenticatedAccounts.has(accountId)) {
        operationalLog("connection.qr_ignored_after_authentication", { account: safeLogRef(accountId) }, "debug");
        return;
      }
      await updateConnection(accountId, { status: WhatsAppConnectionStatus.WAITING_FOR_QR, qrCode: qr, qrExpiresAt: new Date(Date.now() + 60_000), bridgeType: WhatsAppBridgeType.WWEBJS });
      await auditConnection(accountId, "WHATSAPP_QR_AVAILABLE");
      operationalLog("connection.qr_available", { account: safeLogRef(accountId) });
    }));
    activeClient.on("authenticated", () => void enqueueAccountWork(accountId, async () => {
      if (clients.get(accountId) !== activeClient) return;
      if (authenticatedAccounts.has(accountId)) {
        operationalLog("connection.authenticated_repeat", { account: safeLogRef(accountId) }, "debug");
        return;
      }
      authenticatedAccounts.add(accountId);
      await updateConnection(accountId, { status: WhatsAppConnectionStatus.CONNECTING, qrCode: null, qrExpiresAt: null, lastError: null, bridgeType: WhatsAppBridgeType.WWEBJS });
      await auditConnection(accountId, "WHATSAPP_AUTHENTICATED");
      operationalLog("connection.authenticated", { account: safeLogRef(accountId) });
      attachBrowserDiagnostics(accountId, activeClient);
      waitForReady(accountId, activeClient);
      startReadinessProbe(accountId, activeClient);
    }));
    activeClient.on("ready", () => void enqueueAccountWork(accountId, async () => {
      await completeClientReady(accountId, activeClient, "ready_event");
    }));
    activeClient.on("loading_screen", (percent: number) => {
      const progress = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.floor(percent))) : -1;
      operationalLog("connection.loading_screen", { account: safeLogRef(accountId), progress }, "debug");
    });
    activeClient.on("change_state", (state: string) => {
      operationalLog("connection.state_changed", { account: safeLogRef(accountId), state: safeConnectionState(state) });
    });
    activeClient.on("auth_failure", () => void enqueueAccountWork(accountId, async () => {
      await updateConnection(accountId, { status: WhatsAppConnectionStatus.ERROR, qrCode: null, qrExpiresAt: null, lastError: "No se pudo autenticar la sesión de WhatsApp Web.", bridgeType: WhatsAppBridgeType.WWEBJS });
      await auditConnection(accountId, "WHATSAPP_AUTH_FAILURE");
      operationalLog("connection.auth_failure", { account: safeLogRef(accountId) }, "error");
    }));
    activeClient.on("disconnected", () => void enqueueAccountWork(accountId, async () => {
      if (clients.get(accountId) !== activeClient) return;
      await closeClient(accountId, activeClient);
      if (stopping || !(await isAccountActive(accountId))) return;
      await updateConnection(accountId, { status: WhatsAppConnectionStatus.ERROR, qrCode: null, qrExpiresAt: null, lastError: "Conexión de WhatsApp Web interrumpida; reintentando.", bridgeType: WhatsAppBridgeType.WWEBJS });
      await auditConnection(accountId, "WHATSAPP_DISCONNECTED");
      scheduleReconnect(accountId);
    }));
    activeClient.on("contact_changed", (contact: Contact) => void enqueueAccountWork(accountId, async () => {
      const chatId = contact.id?._serialized;
      if (chatId) await upsertContact(accountId, { chatId, displayName: contact.name ?? contact.shortName ?? null, pushName: contact.pushname ?? null });
    }));
    activeClient.on("message", (raw: Message) => void enqueueAccountWork(accountId, () => persistInboundMessageEvent(accountId, activeClient, raw, "message")));
    activeClient.on("message_create", (raw: Message) => void enqueueAccountWork(accountId, async () => {
      const message = normalizeWebMessage(raw as unknown as WebMessageLike);
      if (message?.direction === "INBOUND") return persistInboundMessageEvent(accountId, activeClient, raw, "message_create");
      if (!message || message.direction !== "OUTBOUND") return;
      await persistMessage(accountId, message);
    }));
    activeClient.on("message_ack", (message: Message, ack: number) => void enqueueAccountWork(accountId, async () => {
      if (!message.fromMe) return;
      const externalId = message.id?._serialized;
      if (!externalId) return;
      if (ack === MessageAck.ACK_ERROR) {
        operationalLog("outbound.rejected", { account: safeLogRef(accountId), message: safeLogRef(externalId), phase: "ack_received", status: "FAILED" }, "error");
        await cancelOutboundDelivery(accountId, externalId);
      } else if (ack >= MessageAck.ACK_SERVER) {
        operationalLog("outbound.ack_received", { account: safeLogRef(accountId), message: safeLogRef(externalId), phase: "ack_received", status: "SENT" });
        await completeOutboundRequest(accountId, externalId);
      }
    }));
    await activeClient.initialize();
  } catch (error) {
    // whatsapp-web.js can report a late ready/injection failure after the
    // underlying browser has authenticated and getState() is CONNECTED. Do
    // not destroy that live client: doing so turns a recoverable session into
    // a repeated reconnect loop. Its public message events remain attached.
    if (client && clients.get(accountId) === client && readyAccounts.has(accountId)) {
      operationalLog("connection.initialize_error_after_state_recovery", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error");
      return;
    }
    if (client) await closeClient(accountId, client);
    operationalLog("connection.start_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error");
    if (!stopping && await isAccountActive(accountId)) {
      await updateConnection(accountId, { status: WhatsAppConnectionStatus.ERROR, qrCode: null, qrExpiresAt: null, lastError: "No se pudo iniciar WhatsApp Web; se reintentará.", bridgeType: WhatsAppBridgeType.WWEBJS });
      scheduleReconnect(accountId);
    }
  } finally { connecting.delete(accountId); }
}

async function consumeExplicitRelink(accountId: string, relinkRequestId: string | null | undefined) {
  if (!relinkRequestId) return false;
  await closeClient(accountId);
  await rm(profilePath(accountId), { recursive: true, force: true });
  const consumed = await prisma.whatsAppConnection.updateMany({ where: { accountId, relinkRequestId }, data: { relinkRequestId: null, bridgeType: WhatsAppBridgeType.WWEBJS, status: WhatsAppConnectionStatus.DISCONNECTED, qrCode: null, qrExpiresAt: null, lastError: null } });
  if (consumed.count) await auditConnection(accountId, "WHATSAPP_WEB_SESSION_REMOVED");
  return consumed.count > 0;
}

async function syncAccounts() {
  const accounts = await prisma.whatsAppAccount.findMany({ where: { isActive: true }, select: { id: true, connection: { select: { status: true, bridgeType: true, relinkRequestId: true } } } });
  const allowed = new Set(accounts.map((account) => account.id));
  for (const account of accounts) {
    if (await consumeExplicitRelink(account.id, account.connection?.relinkRequestId)) { void connect(account.id); continue; }
    const status = account.connection?.status;
    // Existing records intentionally do not generate a Web QR until an
    // administrator requests a relink. Linked browser sessions reconnect.
    if (!status || status === WhatsAppConnectionStatus.DISCONNECTED) continue;
    if (!clients.has(account.id) && (await hasProfile(account.id))) void connect(account.id);
  }
  for (const [accountId, client] of clients) if (!allowed.has(accountId)) await closeClient(accountId, client);
}

function logOutboundDeferral(accountId: string, reason: string) {
  const previous = outboundDeferrals.get(accountId); const now = Date.now();
  if (previous?.reason === reason && now - previous.loggedAt < 60_000) return;
  outboundDeferrals.set(accountId, { reason, loggedAt: now });
  operationalLog("outbound.deferred", { account: safeLogRef(accountId), reason, phase: "dispatch", status: "PENDING" });
}

async function processNextOutbound(accountId: string, client: WhatsAppWebClient) {
  const safety = await canDispatchOutbound(accountId);
  if (!safety.allowed) return logOutboundDeferral(accountId, safety.reason);
  const request = await claimNextOutboundRequest(accountId);
  if (!request) return;
  const destination = resolveOutboundDestination(request.conversation);
  const context = { account: safeLogRef(accountId), request: safeLogRef(request.id), destination: destination.kind, phoneFallbackPresent: destination.phoneFallbackPresent };
  operationalLog("outbound.claimed", { ...context, phase: "claimed", status: "SENDING" });
  if (!destination.jid) { await cancelOutboundRequest(request.id, "No se encontró una conversación válida para el destinatario."); return; }
  try {
    operationalLog("outbound.relay_started", { ...context, phase: "relay_started", status: "SENDING" });
    const sent = await presence.duringActivity(accountId, client, () => client.sendMessage(destination.jid!, request.body));
    const externalId = sent.id?._serialized;
    if (!externalId || !(await attachOutboundExternalId(request.id, externalId))) throw new Error("outbound correlation unavailable");
    operationalLog("outbound.correlation_persisted", { ...context, message: safeLogRef(externalId), phase: "relay_started", status: "SENDING" });
    await recordOutboundRelayAccepted(request, externalId, destination.jid);
    operationalLog("outbound.relay_accepted", { ...context, message: safeLogRef(externalId), phase: "relay_accepted", status: "SENDING" });
  } catch (error) {
    operationalLog("outbound.rejected", { ...context, phase: "relay_started", status: "FAILED", ...safeErrorInfo(error) }, "error");
    await cancelOutboundRequest(request.id, "El envío fue cancelado antes de ser confirmado por WhatsApp.");
  }
}

function processOutbound() {
  for (const [accountId, client] of clients) {
    if (!readyAccounts.has(accountId) || outboundWorkQueued.has(accountId)) continue;
    outboundWorkQueued.add(accountId);
    void enqueueAccountWork(accountId, () => processNextOutbound(accountId, client)).finally(() => outboundWorkQueued.delete(accountId));
  }
}

async function processReadReceipts() {
  for (const [accountId, client] of clients) {
    if (!readyAccounts.has(accountId)) continue;
    await enqueueAccountWork(accountId, async () => {
      const request = await claimNextReadReceiptRequest(accountId); if (!request) return;
      const identity = await prisma.conversationExternalIdentity.findFirst({ where: { accountId, conversationId: request.conversationId, bridgeType: WhatsAppBridgeType.WWEBJS }, select: { externalChatId: true } });
      if (!identity) return failReadReceiptRequest(request);
      try { await client.sendSeen(identity.externalChatId); await completeReadReceiptRequest(request); }
      catch { await failReadReceiptRequest(request); }
    });
  }
}

async function processPendingMedia() {
  for (const [accountId, client] of clients) if (readyAccounts.has(accountId)) await enqueueAccountWork(accountId, () => recoverPendingMedia(accountId, client));
}

/**
 * `message` is the primary path. This bounded public-API reconciliation only
 * runs as a safeguard for Web builds where the library fails to forward the
 * browser event. It never scans phone numbers or imports full history.
 */
async function reconcileInboundMessages(accountId: string, client: WhatsAppWebClient) {
  try {
    const chats = await client.getChats();
    const chatsById = new Map(chats.flatMap((chat) => chat.id?._serialized ? [[chat.id._serialized, chat] as const] : []));
    const snapshots = chatSnapshots(chats);
    const watermarks = inboundWatermarks.get(accountId);
    if (!watermarks) {
      inboundWatermarks.set(accountId, seedChatWatermarks(snapshots));
      inboundStartedAt.set(accountId, new Date());
      operationalLog("inbound.reconcile_primed", { account: safeLogRef(accountId), chats: chats.length });
      return;
    }
    const changed = changedChatWatermarks(watermarks, snapshots);
    if (!changed.length) return;
    const startedAtSeconds = Math.floor((inboundStartedAt.get(accountId)?.getTime() ?? Date.now()) / 1_000);
    let candidates = 0;
    for (const chatState of changed.slice(0, 50)) {
      const chat = chatsById.get(chatState.id);
      try {
        if (!chat) throw new Error("chat snapshot is no longer available");
        const minimumTimestamp = Math.max(0, (chatState.previousTimestamp ?? startedAtSeconds) - 1);
        const messages = await chat.fetchMessages({ limit: inboundReconcileLimit });
        for (const raw of messages) {
          const normalized = normalizeWebMessage(raw as unknown as WebMessageLike);
          if (!normalized || normalized.direction !== "INBOUND" || Math.floor(normalized.sentAt.getTime() / 1_000) < minimumTimestamp) continue;
          candidates += 1;
          await persistInboundMessageEvent(accountId, client, raw, "reconcile");
        }
      } catch (error) {
        // `changedChatWatermarks` updates optimistically. Restore the last
        // value for this chat so a temporary public-API failure cannot make a
        // newly arrived message invisible to the next bounded reconciliation.
        if (chatState.previousTimestamp === null) watermarks.delete(chatState.id);
        else watermarks.set(chatState.id, chatState.previousTimestamp);
        operationalLog("inbound.reconcile_chat_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error");
      }
    }
    inboundReconcileFailures.delete(accountId);
    operationalLog("inbound.reconcile_completed", { account: safeLogRef(accountId), chats: changed.length, candidates });
  } catch (error) {
    const failures = (inboundReconcileFailures.get(accountId) ?? 0) + 1;
    inboundReconcileFailures.set(accountId, failures);
    operationalLog("inbound.reconcile_failed", { account: safeLogRef(accountId), failures, ...safeErrorInfo(error) }, "error");
    if (failures >= 3) {
      inboundReconciliationDisabled.add(accountId);
      operationalLog("inbound.reconcile_disabled", { account: safeLogRef(accountId), failures, reason: "PUBLIC_CHAT_API_UNAVAILABLE" }, "error");
    }
  }
}

function processInboundReconciliation() {
  for (const [accountId, client] of clients) {
    if (!readyAccounts.has(accountId) || inboundReconciliationDisabled.has(accountId)) continue;
    void enqueueAccountWork(accountId, () => reconcileInboundMessages(accountId, client));
  }
}

async function processStaleOutboundRequests() {
  const count = await failStaleOutboundRequests();
  if (count) operationalLog("outbound.confirmation_timed_out", { count, phase: "reconciliation", status: "CANCELED" }, "error");
}

function startWorker() {
  operationalLog("connection.mode_continuous", { presence: "unavailable", bridge: "WWEBJS" });
  void syncAccounts().catch((error) => operationalLog("account.check_failed", safeErrorInfo(error), "error"));
  const accountsTimer = setInterval(() => void syncAccounts().catch((error) => operationalLog("account.check_failed", safeErrorInfo(error), "error")), accountCheckMs);
  async function shutdown() {
    stopping = true; clearInterval(accountsTimer);
    for (const timer of reconnectTimers.values()) clearTimeout(timer); reconnectTimers.clear();
    for (const [accountId, client] of [...clients]) await closeClient(accountId, client);
    stopQueueProcessorsIfIdle(); await prisma.$disconnect(); process.exit(0);
  }
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}

if (process.env.WORKER_VERIFY_ONLY === "true") console.info("worker-runtime-ok");
else startWorker();
