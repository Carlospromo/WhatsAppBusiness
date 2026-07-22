/* eslint-disable react-hooks/rules-of-hooks -- Baileys exports a state helper; this is a Node worker. */
/* WhatsApp worker: every account owns an isolated socket and auth directory. */
import "dotenv/config";
import { access, mkdir, rm } from "node:fs/promises";
import makeWASocket, { DisconnectReason, generateWAMessage, useMultiFileAuthState, WAMessageStatus } from "@whiskeysockets/baileys";
import pino from "pino";
import { WhatsAppConnectionStatus } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { auditConnection, updateConnection } from "./lib/whatsapp/connection";
import { maskPhone, normalizeWhatsAppMessage } from "./lib/whatsapp/normalize";
import { persistMessage, upsertContact } from "./lib/whatsapp/persistence";
import { refreshContactProfilePicture, refreshRecentContactProfilePictures } from "./lib/whatsapp/profile-picture";
import { attachOutboundExternalId, claimNextOutboundRequest, completeOutboundRequest, failOutboundDelivery, failOutboundRequest, failStaleOutboundRequests, recordOutboundRelayAccepted } from "./lib/whatsapp/outbound";
import { resolveOutboundDestination } from "./lib/whatsapp/outbound-destination";
import { outboundAckOutcome, safeOutboundRejectionCode, safeOutboundRejectionMessage } from "./lib/whatsapp/outbound-ack";
import { processMediaAttachment, recoverPendingMedia } from "./lib/whatsapp/media";
import { claimNextReadReceiptRequest, completeReadReceiptRequest, failReadReceiptRequest, readReceiptKeys } from "./lib/whatsapp/read-receipts";
import { getOutboundMessageForRetry } from "./lib/whatsapp/message-retry";
import { installDependencySessionLogRedaction } from "./lib/whatsapp/dependency-log-redaction";
import { TransientPresenceManager } from "./lib/whatsapp/transient-presence";
import { canOpenSocket, periodicSyncConfig } from "./lib/whatsapp/periodic-sync";
import { clearGroupMetadataCache, groupMetadataCacheForAccount } from "./lib/whatsapp/group-metadata-cache";
import { canDispatchOutbound, clearOutboundRestriction, pauseOutboundForRestriction } from "./lib/whatsapp/outbound-safety";
import { operationalLog, safeErrorInfo, safeLogRef } from "./lib/operational-log";

const authRoot = process.env.WA_AUTH_DIR || "/data/wa-auth";
const syncConfig = periodicSyncConfig();
type WorkerSocket = Awaited<ReturnType<typeof makeWASocket>>;
type ScheduledSocketState = {
  socket: WorkerSocket;
  opened: boolean;
  receivedPendingNotifications: boolean;
  closeTimer?: ReturnType<typeof setTimeout>;
};
let stopping = false;
const sockets = new Map<string, Awaited<ReturnType<typeof makeWASocket>>>();
const connecting = new Set<string>();
const resettingAuth = new Set<string>();
const accountQueues = new Map<string, Promise<void>>();
const outboundWorkQueued = new Set<string>();
const outboundDeferrals = new Map<string, { reason: string; loggedAt: number }>();
const reconnectAttempts = new Map<string, number>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const explicitLinking = new Set<string>();
const explicitLinkTimers = new Map<string, ReturnType<typeof setTimeout>>();
const reachoutRestrictions = new Map<string, boolean>();
const scheduledSocketStates = new Map<string, ScheduledSocketState>();
let scheduledWindowActive = false;
let scheduledWindowTimer: ReturnType<typeof setTimeout> | undefined;
let outboundTimer: ReturnType<typeof setInterval> | undefined;
let mediaTimer: ReturnType<typeof setInterval> | undefined;
let readReceiptTimer: ReturnType<typeof setInterval> | undefined;
let staleOutboundTimer: ReturnType<typeof setInterval> | undefined;
// Baileys can log raw protocol nodes. All production diagnostics go through
// operationalLog instead, which only emits hashed references and safe fields.
const baileysLogger = pino({ level: "silent" });
installDependencySessionLogRedaction();
const presence = new TransientPresenceManager(3_000, (accountId, error) => {
  operationalLog("presence.update_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "debug");
});

function authPath(accountId: string) { return `${authRoot}/${accountId}`; }

function canUseSocket(accountId: string) {
  return canOpenSocket(syncConfig.mode, scheduledWindowActive, explicitLinking.has(accountId));
}

function clearReconnectTimer(accountId: string) {
  const timer = reconnectTimers.get(accountId);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(accountId);
}

function resetReconnectDelay(accountId: string) {
  reconnectAttempts.delete(accountId);
  clearReconnectTimer(accountId);
}

/**
 * This is connection-level jitter, not a messaging delay. It prevents a
 * temporary network outage from making every account reconnect simultaneously.
 */
function scheduleReconnect(accountId: string) {
  if (stopping || reconnectTimers.has(accountId) || !canUseSocket(accountId)) return;
  const attempt = Math.min(reconnectAttempts.get(accountId) ?? 0, 6);
  const baseDelayMs = Math.min(5_000 * 2 ** attempt, 60_000);
  const spreadMs = Math.round(baseDelayMs * 0.2);
  const delayMs = baseDelayMs - spreadMs + Math.floor(Math.random() * (spreadMs * 2 + 1));
  reconnectAttempts.set(accountId, attempt + 1);
  operationalLog("connection.reconnect_scheduled", { account: safeLogRef(accountId), attempt: attempt + 1, delayMs }, "debug");
  const timer = setTimeout(() => {
    reconnectTimers.delete(accountId);
    void connect(accountId);
  }, delayMs);
  reconnectTimers.set(accountId, timer);
}

async function isAccountActive(accountId: string) {
  return Boolean(await prisma.whatsAppAccount.findFirst({ where: { id: accountId, isActive: true }, select: { id: true } }));
}

async function hasPersistedAuth(accountId: string) {
  try {
    await access(`${authPath(accountId)}/creds.json`);
    return true;
  } catch {
    return false;
  }
}

function enqueueAccountWork(accountId: string, work: () => Promise<void>) {
  const previous = accountQueues.get(accountId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work).catch(() => undefined);
  accountQueues.set(accountId, next);
  return next;
}

function startQueueProcessors() {
  if (outboundTimer) return;
  outboundTimer = setInterval(() => void processOutbound(), 1_500);
  mediaTimer = setInterval(() => void processPendingMedia(), 10_000);
  readReceiptTimer = setInterval(() => void processReadReceipts(), 2_000);
  staleOutboundTimer = setInterval(() => void processStaleOutboundRequests(), 60_000);
  void processStaleOutboundRequests();
}

function stopQueueProcessorsIfIdle() {
  if (sockets.size > 0) return;
  if (outboundTimer) clearInterval(outboundTimer);
  if (mediaTimer) clearInterval(mediaTimer);
  if (readReceiptTimer) clearInterval(readReceiptTimer);
  if (staleOutboundTimer) clearInterval(staleOutboundTimer);
  outboundTimer = undefined;
  mediaTimer = undefined;
  readReceiptTimer = undefined;
  staleOutboundTimer = undefined;
}

function clearScheduledSocketState(accountId: string, socket?: WorkerSocket) {
  const state = scheduledSocketStates.get(accountId);
  if (!state || (socket && state.socket !== socket)) return;
  if (state.closeTimer) clearTimeout(state.closeTimer);
  scheduledSocketStates.delete(accountId);
}

function closeScheduledSocketAfterPendingNotifications(accountId: string, state: ScheduledSocketState) {
  if (syncConfig.mode !== "periodic") return;
  if (!state.opened || !state.receivedPendingNotifications || state.closeTimer) return;
  state.closeTimer = setTimeout(() => {
    if (scheduledSocketStates.get(accountId) !== state) return;
    operationalLog("sync.window_ready_finished", { account: safeLogRef(accountId), windowMs: syncConfig.windowMs }, "debug");
    void closeSocket(accountId, state.socket).catch((error) => operationalLog("sync.window_close_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error"));
  }, syncConfig.windowMs);
  operationalLog("sync.pending_notifications_ready", { account: safeLogRef(accountId), windowMs: syncConfig.windowMs });
}

function registerScheduledSocket(accountId: string, socket: WorkerSocket) {
  if (syncConfig.mode !== "periodic" || !scheduledWindowActive || explicitLinking.has(accountId)) return;
  clearScheduledSocketState(accountId);
  scheduledSocketStates.set(accountId, { socket, opened: false, receivedPendingNotifications: false });
}

function markScheduledSocketOpen(accountId: string, socket: WorkerSocket) {
  if (syncConfig.mode !== "periodic") return;
  const state = scheduledSocketStates.get(accountId);
  if (!state || state.socket !== socket) return;
  state.opened = true;
  closeScheduledSocketAfterPendingNotifications(accountId, state);
}

function markScheduledPendingNotifications(accountId: string, socket: WorkerSocket) {
  if (syncConfig.mode !== "periodic") return;
  const state = scheduledSocketStates.get(accountId);
  if (!state || state.socket !== socket || state.receivedPendingNotifications) return;
  state.receivedPendingNotifications = true;
  operationalLog("sync.pending_notifications_received", { account: safeLogRef(accountId) });
  closeScheduledSocketAfterPendingNotifications(accountId, state);
}

async function closeSocket(accountId: string, socket: WorkerSocket) {
  clearScheduledSocketState(accountId, socket);
  if (sockets.get(accountId) === socket) sockets.delete(accountId);
  await presence.dispose(accountId, socket);
  clearGroupMetadataCache(accountId);
  try {
    await socket.end(undefined);
  } catch {
    // The socket can already be closed by Baileys while a periodic window ends.
  }
  stopQueueProcessorsIfIdle();
}

function clearExplicitLinkTimer(accountId: string) {
  const timer = explicitLinkTimers.get(accountId);
  if (timer) clearTimeout(timer);
  explicitLinkTimers.delete(accountId);
}

async function endExplicitLinkWindow(accountId: string) {
  explicitLinkTimers.delete(accountId);
  explicitLinking.delete(accountId);
  resetReconnectDelay(accountId);
  if (syncConfig.mode === "periodic" && !scheduledWindowActive) {
    const socket = sockets.get(accountId);
    if (socket) await closeSocket(accountId, socket);
  }
  const expired = await prisma.whatsAppConnection.updateMany({
    where: { accountId, status: WhatsAppConnectionStatus.WAITING_FOR_QR },
    data: { status: WhatsAppConnectionStatus.DISCONNECTED, qrCode: null, qrExpiresAt: null, lastError: "El QR ha caducado; solicita una nueva vinculación." },
  });
  if (expired.count) operationalLog("connection.link_window_expired", { account: safeLogRef(accountId) }, "debug");
}

function startExplicitLinkWindow(accountId: string) {
  explicitLinking.add(accountId);
  resetReconnectDelay(accountId);
  clearExplicitLinkTimer(accountId);
  operationalLog("connection.link_window_started", { account: safeLogRef(accountId), durationMs: syncConfig.linkWindowMs }, "debug");
  const timer = setTimeout(() => void endExplicitLinkWindow(accountId).catch((error) => operationalLog("connection.link_window_finish_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error")), syncConfig.linkWindowMs);
  explicitLinkTimers.set(accountId, timer);
  void connect(accountId);
}

async function endScheduledWindow() {
  if (!scheduledWindowActive) return;
  scheduledWindowActive = false;
  scheduledWindowTimer = undefined;
  for (const accountId of [...reconnectTimers.keys()]) if (!explicitLinking.has(accountId)) resetReconnectDelay(accountId);
  for (const [accountId, socket] of [...sockets]) if (!explicitLinking.has(accountId)) await closeSocket(accountId, socket);
  operationalLog("sync.window_finished", { connectTimeoutMs: syncConfig.connectTimeoutMs, windowMs: syncConfig.windowMs }, "debug");
}

async function startScheduledWindow() {
  if (stopping || scheduledWindowActive) return;
  scheduledWindowActive = true;
  if (scheduledWindowTimer) clearTimeout(scheduledWindowTimer);
  scheduledWindowTimer = setTimeout(() => void endScheduledWindow().catch((error) => operationalLog("sync.window_finish_failed", safeErrorInfo(error), "error")), syncConfig.connectTimeoutMs + syncConfig.windowMs);
  operationalLog("sync.window_started", { intervalMs: syncConfig.intervalMs, connectTimeoutMs: syncConfig.connectTimeoutMs, windowMs: syncConfig.windowMs }, "debug");
  await syncAccounts(true);
}

async function connect(accountId: string) {
  if (stopping || !canUseSocket(accountId) || connecting.has(accountId) || sockets.has(accountId) || reconnectTimers.has(accountId)) return;
  if (!(await isAccountActive(accountId))) return;
  connecting.add(accountId);
  let socket: Awaited<ReturnType<typeof makeWASocket>> | undefined;
  try {
    operationalLog("connection.connecting", { account: safeLogRef(accountId) });
    await mkdir(authPath(accountId), { recursive: true });
    await updateConnection(accountId, { status: WhatsAppConnectionStatus.CONNECTING, qrCode: null, qrExpiresAt: null, lastError: null });
    const { state, saveCreds } = await useMultiFileAuthState(authPath(accountId));
    const groupMetadataCache = groupMetadataCacheForAccount(accountId);
    const activeSocket = makeWASocket({
      auth: state,
      logger: baileysLogger,
      printQRInTerminal: false,
      syncFullHistory: false,
      // The dashboard does not use WhatsApp properties, block lists or
      // privacy settings. Skipping these optional queries avoids their
      // one-minute timeout without affecting real-time messages or sending.
      fireInitQueries: false,
      markOnlineOnConnect: false,
      cachedGroupMetadata: async (jid) => groupMetadataCache.get(jid),
      // A retry receipt can arrive after the in-memory Baileys cache has been
      // cleared. The persisted manual text is sufficient to rebuild it.
      getMessage: async (key) => getOutboundMessageForRetry(accountId, key.id),
    });
    socket = activeSocket;
    if (!canUseSocket(accountId)) {
      await activeSocket.end(undefined);
      return;
    }
    sockets.set(accountId, activeSocket);
    registerScheduledSocket(accountId, activeSocket);
    startQueueProcessors();
    operationalLog("connection.socket_created", { account: safeLogRef(accountId) });
    activeSocket.ev.on("creds.update", saveCreds);
    activeSocket.ev.on("groups.upsert", (groups) => { for (const group of groups) groupMetadataCache.set(group); });
    activeSocket.ev.on("groups.update", (groups) => {
      for (const group of groups) {
        if (!group.id) continue;
        const cached = groupMetadataCache.get(group.id);
        if (cached) groupMetadataCache.set({ ...cached, ...group });
      }
    });
    activeSocket.ev.on("contacts.upsert", (contacts) => void enqueueAccountWork(accountId, async () => { for (const contact of contacts) if (contact.id) await upsertContact(accountId, { jid: contact.id, displayName: contact.name, pushName: contact.notify }); }));
    activeSocket.ev.on("contacts.update", (contacts) => void enqueueAccountWork(accountId, async () => { for (const contact of contacts) if (contact.id) await upsertContact(accountId, { jid: contact.id, displayName: contact.name, pushName: contact.notify }); }));
    activeSocket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      void enqueueAccountWork(accountId, async () => {
        for (const raw of messages) {
          const message = normalizeWhatsAppMessage(raw);
          if (!message) continue;
          const persisted = message.direction === "INBOUND"
            ? await presence.duringActivity(accountId, activeSocket, () => persistMessage(accountId, message))
            : await persistMessage(accountId, message);
          if (persisted.mediaAttachment) await processMediaAttachment(accountId, persisted.mediaAttachment.id, activeSocket, raw);
          if (message.conversationType === "DIRECT") await refreshContactProfilePicture(accountId, activeSocket, message.conversationJid);
        }
      });
    });
    activeSocket.ev.on("messages.update", (updates) => {
      void enqueueAccountWork(accountId, async () => {
        for (const update of updates) {
          const externalId = update.key.id;
          const status = update.update.status;
          if (!update.key.fromMe || !externalId || typeof status !== "number") continue;
          const outcome = outboundAckOutcome(status, WAMessageStatus.ERROR, WAMessageStatus.SERVER_ACK);
          if (outcome === "REJECTED") {
            const code = safeOutboundRejectionCode(update.update.messageStubParameters) ?? (reachoutRestrictions.get(accountId) ? 463 : undefined);
            operationalLog("outbound.rejected", { account: safeLogRef(accountId), message: safeLogRef(externalId), phase: "ack_received", status: "FAILED", code }, "error");
            if (code === 463) await pauseOutboundForRestriction(accountId);
            await failOutboundDelivery(accountId, externalId, safeOutboundRejectionMessage(code));
            continue;
          }
          if (outcome === "ACKNOWLEDGED") {
            operationalLog("outbound.ack_received", { account: safeLogRef(accountId), message: safeLogRef(externalId), phase: "ack_received", status: "SENT" });
            await completeOutboundRequest(accountId, externalId);
          }
        }
      }).catch((error) => operationalLog("outbound.ack_persist_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error"));
    });
    activeSocket.ev.on("connection.update", async ({ connection, lastDisconnect, qr, reachoutTimeLock, receivedPendingNotifications }) => {
      if (sockets.get(accountId) !== activeSocket) return;
      if (reachoutTimeLock) {
        const isActive = reachoutTimeLock.isActive === true;
        reachoutRestrictions.set(accountId, isActive);
        if (isActive) await pauseOutboundForRestriction(accountId, reachoutTimeLock.timeEnforcementEnds);
        else await clearOutboundRestriction(accountId);
        operationalLog("outbound.restriction_updated", { account: safeLogRef(accountId), code: 463, active: isActive, phase: "ack_received" }, isActive ? "error" : "info");
      }
      if (receivedPendingNotifications === true) markScheduledPendingNotifications(accountId, activeSocket);
      if (qr) { if (!(await isAccountActive(accountId))) { await activeSocket.end(undefined); return; } await updateConnection(accountId, { status: WhatsAppConnectionStatus.WAITING_FOR_QR, qrCode: qr, qrExpiresAt: new Date(Date.now() + 60_000) }); await auditConnection(accountId, "WHATSAPP_QR_AVAILABLE"); }
      if (connection === "open") {
        if (!(await isAccountActive(accountId))) { await activeSocket.end(undefined); return; }
        resetReconnectDelay(accountId);
        const jid = activeSocket.user?.id ?? null;
        await updateConnection(accountId, { status: WhatsAppConnectionStatus.CONNECTED, qrCode: null, qrExpiresAt: null, accountJid: jid, maskedPhone: maskPhone(jid), lastError: null });
        await auditConnection(accountId, "WHATSAPP_CONNECTED");
        await presence.markIdle(accountId, activeSocket);
        markScheduledSocketOpen(accountId, activeSocket);
        operationalLog("connection.open", { account: safeLogRef(accountId) });
        void enqueueAccountWork(accountId, async () => { await refreshRecentContactProfilePictures(accountId, activeSocket); await recoverPendingMedia(accountId, activeSocket); });
      }
      if (connection === "close") {
        sockets.delete(accountId);
        clearScheduledSocketState(accountId, activeSocket);
        clearGroupMetadataCache(accountId);
        void presence.dispose(accountId, activeSocket);
        stopQueueProcessorsIfIdle();
        if (stopping || !(await isAccountActive(accountId))) return;
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          resetReconnectDelay(accountId);
          await updateConnection(accountId, { status: WhatsAppConnectionStatus.DISCONNECTED, qrCode: null, qrExpiresAt: null, lastError: "Sesión desvinculada." });
          await auditConnection(accountId, "WHATSAPP_DISCONNECTED");
          return;
        }
        await updateConnection(accountId, { status: WhatsAppConnectionStatus.ERROR, qrCode: null, qrExpiresAt: null, lastError: "Conexión interrumpida; reintentando." });
        await auditConnection(accountId, "WHATSAPP_CONNECTION_ERROR");
        scheduleReconnect(accountId);
      }
    });
  } catch (error) {
    if (socket && sockets.get(accountId) === socket) sockets.delete(accountId);
    stopQueueProcessorsIfIdle();
    operationalLog("connection.start_failed", { account: safeLogRef(accountId), ...safeErrorInfo(error) }, "error");
    if (!stopping && await isAccountActive(accountId)) {
      await updateConnection(accountId, { status: WhatsAppConnectionStatus.ERROR, qrCode: null, qrExpiresAt: null, lastError: "No se pudo iniciar la conexión; se reintentará." });
      await auditConnection(accountId, "WHATSAPP_CONNECTION_ERROR");
      scheduleReconnect(accountId);
    }
  } finally { connecting.delete(accountId); }
}

async function syncAccounts(openScheduledSessions = false) {
  const accounts = await prisma.whatsAppAccount.findMany({ where: { isActive: true }, select: { id: true, connection: { select: { status: true, relinkRequestId: true } } } });
  const allowed = new Set(accounts.map((account) => account.id));
  for (const account of accounts) {
    const resetForRelink = await resetAuthForExplicitRelink(account.id, account.connection?.relinkRequestId);
    if (resetForRelink) {
      startExplicitLinkWindow(account.id);
      continue;
    }
    const socket = sockets.get(account.id);
    if (socket && account.connection?.status === WhatsAppConnectionStatus.DISCONNECTED && !explicitLinking.has(account.id)) {
      await closeSocket(account.id, socket);
      continue;
    }
    if (!openScheduledSessions || socket) continue;
    const status = account.connection?.status;
    // A normal cycle only reuses an already-linked session. It never creates
    // unsolicited QR codes for a new or explicitly disconnected account.
    if (!status || status === WhatsAppConnectionStatus.DISCONNECTED || status === WhatsAppConnectionStatus.WAITING_FOR_QR) continue;
    if (!(await hasPersistedAuth(account.id))) {
      await updateConnection(account.id, {
        status: WhatsAppConnectionStatus.DISCONNECTED,
        qrCode: null,
        qrExpiresAt: null,
        lastError: "La sesión no está disponible; solicita una nueva vinculación.",
      });
      await auditConnection(account.id, "WHATSAPP_SESSION_UNAVAILABLE");
      continue;
    }
    void connect(account.id);
  }
  for (const [id, socket] of sockets) {
    if (allowed.has(id)) continue;
    explicitLinking.delete(id);
    clearExplicitLinkTimer(id);
    resetReconnectDelay(id);
    await closeSocket(id, socket);
  }
}

function processOutbound() {
  for (const [accountId, socket] of sockets) {
    if (!socket.user) continue;
    if (outboundWorkQueued.has(accountId)) continue;
    outboundWorkQueued.add(accountId);
    void enqueueAccountWork(accountId, () => processNextOutbound(accountId, socket))
      .finally(() => outboundWorkQueued.delete(accountId));
  }
}

function logOutboundDeferral(accountId: string, reason: string) {
  const previous = outboundDeferrals.get(accountId);
  const now = Date.now();
  if (previous?.reason === reason && now - previous.loggedAt < 60_000) return;
  outboundDeferrals.set(accountId, { reason, loggedAt: now });
  operationalLog("outbound.deferred", { account: safeLogRef(accountId), reason, phase: "dispatch", status: "PENDING" });
}

async function processStaleOutboundRequests() {
  const failed = await failStaleOutboundRequests();
  if (failed) operationalLog("outbound.confirmation_timed_out", { count: failed, phase: "reconciliation", status: "FAILED" }, "error");
}

async function processNextOutbound(accountId: string, socket: WorkerSocket) {
  const dispatchSafety = await canDispatchOutbound(accountId);
  if (!dispatchSafety.allowed) {
    logOutboundDeferral(accountId, dispatchSafety.reason);
    return;
  }
  outboundDeferrals.delete(accountId);
  const request = await claimNextOutboundRequest(accountId);
  if (!request) return;
  const destination = resolveOutboundDestination(request.conversation);
  const logContext = {
    account: safeLogRef(accountId),
    request: safeLogRef(request.id),
    destination: destination.kind,
    phoneFallbackPresent: destination.phoneFallbackPresent,
  };
  operationalLog("outbound.claimed", { ...logContext, phase: "claimed", status: "SENDING" });
  if (!destination.jid) {
    operationalLog("outbound.rejected", { ...logContext, phase: "destination_resolved", status: "FAILED" }, "error");
    await failOutboundRequest(request.id, "No se encontró una identidad válida para el destinatario.");
    return;
  }
  const destinationJid = destination.jid;
  try {
      operationalLog("outbound.destination_resolved", { ...logContext, phase: "destination_resolved", status: "SENDING" });
      operationalLog("outbound.relay_started", { ...logContext, phase: "relay_started", status: "SENDING" });
      // Refresh the device list for this one explicit manual send. It avoids
      // encrypting against a stale recipient-device cache after a relink or
      // a recipient device change; it is not a contact discovery operation.
      let externalId: string | null | undefined;
      await presence.duringActivity(accountId, socket, async () => {
        if (destination.kind === "group" && !await groupMetadataCacheForAccount(accountId).ensure(socket, destinationJid)) {
          throw new Error("group metadata unavailable");
        }
        const sent = await generateWAMessage(destinationJid, { text: request.body }, {
          userJid: socket.user!.id,
          logger: baileysLogger,
          getUrlInfo: async () => undefined,
          // Required by Baileys' generic generator. This text-only route never
          // invokes it and still does not expose media sending.
          upload: socket.waUploadToServer,
        });
        externalId = sent.key.id;
        if (!externalId) throw new Error("missing message id");
        if (!sent.message) throw new Error("missing message payload");
        if (!(await attachOutboundExternalId(request.id, externalId))) throw new Error("outbound request could not be correlated");
        operationalLog("outbound.correlation_persisted", { ...logContext, message: safeLogRef(externalId), phase: "relay_started", status: "SENDING" });
        await socket.relayMessage(destinationJid, sent.message, {
          messageId: externalId,
          useUserDevicesCache: false,
        });
      });
      if (!externalId) throw new Error("missing message id");
      operationalLog("outbound.relay_accepted", { ...logContext, message: safeLogRef(externalId), phase: "relay_accepted", status: "SENDING" });
      const relayStillPending = await recordOutboundRelayAccepted(request, externalId, destinationJid);
      operationalLog("outbound.persisted", { ...logContext, message: safeLogRef(externalId), phase: "persisted", status: relayStillPending ? "SENDING" : "FAILED" });
      if (request.conversation.type === "DIRECT") try { await refreshContactProfilePicture(accountId, socket, request.conversation.jid); } catch { /* A profile picture must never change the outcome of an accepted relay. */ }
  } catch (error) {
    operationalLog("outbound.rejected", { ...logContext, phase: "relay_started", status: "FAILED", ...safeErrorInfo(error) }, "error");
    await failOutboundRequest(request.id);
  }
}

async function resetAuthForExplicitRelink(accountId: string, requestId: string | null | undefined) {
  if (!requestId || resettingAuth.has(accountId)) return false;
  resettingAuth.add(accountId);
  try {
    resetReconnectDelay(accountId);
    explicitLinking.delete(accountId);
    clearExplicitLinkTimer(accountId);
    const socket = sockets.get(accountId);
    if (socket) await closeSocket(accountId, socket);
    // Credentials are removed only after an authenticated administrator has
    // requested a new link. Other disconnects continue to preserve them.
    await rm(authPath(accountId), { recursive: true, force: true });
    const consumed = await prisma.whatsAppConnection.updateMany({
      where: { accountId, relinkRequestId: requestId },
      data: { relinkRequestId: null },
    });
    return consumed.count > 0;
  } finally {
    resettingAuth.delete(accountId);
  }
}

async function processPendingMedia() {
  for (const [accountId, socket] of sockets) {
    if (!socket.user) continue;
    await enqueueAccountWork(accountId, () => recoverPendingMedia(accountId, socket));
  }
}

async function processReadReceipts() {
  for (const [accountId, socket] of sockets) {
    if (!socket.user) continue;
    await enqueueAccountWork(accountId, async () => {
      const request = await claimNextReadReceiptRequest(accountId);
      if (!request) return;
      const keys = readReceiptKeys(request.conversation, request.messages.map(({ message }) => message));
      try {
        // Baileys owns the active socket. The web/API process only creates a
        // durable request; it never emits WhatsApp receipts itself.
        if (keys.length) await socket.readMessages(keys);
        await completeReadReceiptRequest(request);
      } catch {
        await failReadReceiptRequest(request);
      }
    });
  }
}

function startWorker() {
  if (syncConfig.mode === "periodic") {
    void startScheduledWindow().catch((error) => operationalLog("sync.window_start_failed", safeErrorInfo(error), "error"));
  } else {
    void syncAccounts(true).catch((error) => operationalLog("account.check_failed", safeErrorInfo(error), "error"));
    operationalLog("connection.mode_continuous", { presence: "unavailable" });
  }
  // In continuous mode this keeps active accounts connected. In periodic mode
  // it only notices an explicit administrator relink or deactivation.
  const accountsTimer = setInterval(() => void syncAccounts(syncConfig.mode === "continuous").catch((error) => operationalLog("account.check_failed", safeErrorInfo(error), "error")), syncConfig.accountCheckMs);
  const scheduleTimer = syncConfig.mode === "periodic"
    ? setInterval(() => void startScheduledWindow().catch((error) => operationalLog("sync.window_start_failed", safeErrorInfo(error), "error")), syncConfig.intervalMs)
    : undefined;
  async function shutdown() {
    stopping = true;
    clearInterval(accountsTimer); if (scheduleTimer) clearInterval(scheduleTimer);
    if (scheduledWindowTimer) clearTimeout(scheduledWindowTimer);
    scheduledWindowTimer = undefined;
    for (const timer of reconnectTimers.values()) clearTimeout(timer);
    reconnectTimers.clear();
    for (const timer of explicitLinkTimers.values()) clearTimeout(timer);
    explicitLinkTimers.clear();
    explicitLinking.clear();
    for (const [accountId, socket] of [...sockets]) {
      await closeSocket(accountId, socket);
    }
    for (const state of scheduledSocketStates.values()) if (state.closeTimer) clearTimeout(state.closeTimer);
    scheduledSocketStates.clear();
    stopQueueProcessorsIfIdle();
    await prisma.$disconnect();
    process.exit(0);
  }
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (process.env.WORKER_VERIFY_ONLY === "true") console.info("worker-runtime-ok");
else startWorker();
