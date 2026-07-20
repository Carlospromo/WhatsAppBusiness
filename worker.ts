/* eslint-disable react-hooks/rules-of-hooks -- Baileys exports a state helper; this is a Node worker. */
/* WhatsApp worker: every account owns an isolated socket and auth directory. */
import "dotenv/config";
import { mkdir, rm } from "node:fs/promises";
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState, WAMessageStatus } from "@whiskeysockets/baileys";
import { WhatsAppConnectionStatus } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { auditConnection, updateConnection } from "./lib/whatsapp/connection";
import { maskPhone, normalizeWhatsAppMessage } from "./lib/whatsapp/normalize";
import { persistMessage, upsertContact } from "./lib/whatsapp/persistence";
import { refreshContactProfilePicture, refreshRecentContactProfilePictures } from "./lib/whatsapp/profile-picture";
import { claimNextOutboundRequest, completeOutboundRequest, failOutboundDelivery, failOutboundRequest } from "./lib/whatsapp/outbound";
import { outboundDestinationJid } from "./lib/whatsapp/outbound-destination";
import { processMediaAttachment, recoverPendingMedia } from "./lib/whatsapp/media";
import { claimNextReadReceiptRequest, completeReadReceiptRequest, failReadReceiptRequest, readReceiptKeys } from "./lib/whatsapp/read-receipts";
import { applyHistoryRecoveryPage, claimHistoryRecovery, failHistoryRecovery, requestHistoryPage } from "./lib/whatsapp/history-recovery";
import { operationalLog, safeErrorInfo, safeLogRef } from "./lib/operational-log";
import { getOutboundMessageForRetry } from "./lib/whatsapp/message-retry";

const authRoot = process.env.WA_AUTH_DIR || "/data/wa-auth";
let stopping = false;
const sockets = new Map<string, Awaited<ReturnType<typeof makeWASocket>>>();
const connecting = new Set<string>();
const connectedAccounts = new Set<string>();
const resettingAuth = new Set<string>();
const accountQueues = new Map<string, Promise<void>>();
const lastBlockedOutboundLogAt = new Map<string, number>();
const baileysLogger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, child() { return baileysLogger; } } as never;

function authPath(accountId: string) { return `${authRoot}/${accountId}`; }
function accountLogRef(accountId: string) { return safeLogRef(accountId); }
function destinationKind(jid: string) { return jid.endsWith("@lid") ? "lid" : jid.endsWith("@s.whatsapp.net") ? "phone" : jid.endsWith("@g.us") ? "group" : "unknown"; }
function outboundStatus(status: number | null | undefined) {
  switch (status) {
    case WAMessageStatus.PENDING: return "pending";
    case WAMessageStatus.SERVER_ACK: return "server_ack";
    case WAMessageStatus.DELIVERY_ACK: return "delivery_ack";
    case WAMessageStatus.READ: return "read";
    case WAMessageStatus.PLAYED: return "played";
    case WAMessageStatus.ERROR: return "error";
    default: return "unknown";
  }
}
async function getMessageForRetry(accountId: string, externalId: string | null | undefined) {
  try {
    const message = await getOutboundMessageForRetry(accountId, externalId);
    operationalLog(message ? "outbound.retry_source_found" : "outbound.retry_source_missing", { account: accountLogRef(accountId), message: externalId ? safeLogRef(externalId) : null });
    return message;
  } catch (error) {
    operationalLog("outbound.retry_source_failed", { account: accountLogRef(accountId), message: externalId ? safeLogRef(externalId) : null, ...safeErrorInfo(error) }, "error");
    return undefined;
  }
}

async function isAccountActive(accountId: string) {
  return Boolean(await prisma.whatsAppAccount.findFirst({ where: { id: accountId, isActive: true }, select: { id: true } }));
}

function enqueueAccountWork(accountId: string, work: () => Promise<void>) {
  const previous = accountQueues.get(accountId) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(work);
  const guarded = queued.catch((error) => operationalLog("account_queue.failed", { account: accountLogRef(accountId), ...safeErrorInfo(error) }, "error"));
  accountQueues.set(accountId, guarded);
  return guarded;
}

async function connect(accountId: string) {
  if (stopping || connecting.has(accountId) || sockets.has(accountId)) return;
  if (!(await isAccountActive(accountId))) return;
  operationalLog("connection.connecting", { account: accountLogRef(accountId) });
  connecting.add(accountId);
  let socket: Awaited<ReturnType<typeof makeWASocket>> | undefined;
  try {
    await mkdir(authPath(accountId), { recursive: true });
    await updateConnection(accountId, { status: WhatsAppConnectionStatus.CONNECTING, qrCode: null, qrExpiresAt: null, lastError: null });
    const { state, saveCreds } = await useMultiFileAuthState(authPath(accountId));
    const { version } = await fetchLatestBaileysVersion();
    const activeSocket = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      printQRInTerminal: false,
      syncFullHistory: false,
      // The application does not use WhatsApp properties, block lists or
      // privacy settings. Avoid a one-minute init-query timeout that can
      // otherwise leave a Railway worker busy after it has opened its socket.
      fireInitQueries: false,
      markOnlineOnConnect: false,
      getMessage: async (key) => getMessageForRetry(accountId, key.id),
    });
    socket = activeSocket;
    sockets.set(accountId, activeSocket);
    operationalLog("connection.socket_created", { account: accountLogRef(accountId) });
    activeSocket.ev.on("creds.update", saveCreds);
    activeSocket.ev.on("contacts.upsert", (contacts) => void enqueueAccountWork(accountId, async () => { for (const contact of contacts) if (contact.id) await upsertContact(accountId, { jid: contact.id, displayName: contact.name, pushName: contact.notify }); }));
    activeSocket.ev.on("contacts.update", (contacts) => void enqueueAccountWork(accountId, async () => { for (const contact of contacts) if (contact.id) await upsertContact(accountId, { jid: contact.id, displayName: contact.name, pushName: contact.notify }); }));
    activeSocket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      void enqueueAccountWork(accountId, async () => {
        for (const raw of messages) {
          const message = normalizeWhatsAppMessage(raw);
          const messageRef = raw.key.id ? safeLogRef(raw.key.id) : null;
          if (!message) {
            operationalLog("inbound.ignored", { account: accountLogRef(accountId), message: messageRef });
            continue;
          }
          operationalLog("inbound.received", { account: accountLogRef(accountId), message: messageRef, type: message.messageType, direction: message.direction });
          const persisted = await persistMessage(accountId, message);
          operationalLog("inbound.persisted", { account: accountLogRef(accountId), message: messageRef, created: persisted.created });
          if (persisted.mediaAttachment) void processMediaAttachment(accountId, persisted.mediaAttachment.id, activeSocket, raw);
          if (message.conversationType === "DIRECT") void refreshContactProfilePicture(accountId, activeSocket, message.phoneJid ?? message.conversationJid);
        }
      });
    });
    activeSocket.ev.on("messaging-history.set", ({ messages, peerDataRequestSessionId }) => void enqueueAccountWork(accountId, () => applyHistoryRecoveryPage(accountId, peerDataRequestSessionId, messages)));
    activeSocket.ev.on("messages.update", (updates) => {
      for (const update of updates) {
        const externalId = update.key.id;
        if (update.key.fromMe && externalId && update.update.status !== undefined) {
          // sendMessage returning is only the local relay acknowledgement.
          // This later event identifies the server/delivery result without
          // disclosing the destination, message text or WhatsApp identifiers.
          operationalLog("outbound.status_updated", {
            account: accountLogRef(accountId),
            message: safeLogRef(externalId),
            status: outboundStatus(update.update.status),
          });
        }
        if (update.key.fromMe && externalId && update.update.status === WAMessageStatus.ERROR) {
          operationalLog("outbound.delivery_rejected", { account: accountLogRef(accountId), message: safeLogRef(externalId) }, "error");
          void failOutboundDelivery(accountId, externalId).catch((error) => operationalLog("outbound.delivery_rejection_persist_failed", { account: accountLogRef(accountId), message: safeLogRef(externalId), ...safeErrorInfo(error) }, "error"));
        }
      }
    });
    activeSocket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (sockets.get(accountId) !== activeSocket) return;
      if (qr) { operationalLog("connection.qr_available", { account: accountLogRef(accountId) }); if (!(await isAccountActive(accountId))) { await activeSocket.end(undefined); return; } await updateConnection(accountId, { status: WhatsAppConnectionStatus.WAITING_FOR_QR, qrCode: qr, qrExpiresAt: new Date(Date.now() + 60_000) }); await auditConnection(accountId, "WHATSAPP_QR_AVAILABLE"); }
      if (connection === "open") {
        if (!(await isAccountActive(accountId))) { await activeSocket.end(undefined); return; }
        const jid = activeSocket.user?.id ?? null;
        await updateConnection(accountId, { status: WhatsAppConnectionStatus.CONNECTED, qrCode: null, qrExpiresAt: null, accountJid: jid, maskedPhone: maskPhone(jid), lastError: null });
        // socket.user is populated from saved credentials before the WebSocket
        // has opened, so only this event makes an account eligible to send.
        connectedAccounts.add(accountId);
        operationalLog("connection.open", { account: accountLogRef(accountId) });
        await auditConnection(accountId, "WHATSAPP_CONNECTED");
        void refreshRecentContactProfilePictures(accountId, activeSocket);
        void recoverPendingMedia(accountId, activeSocket);
      }
      if (connection === "close") {
        connectedAccounts.delete(accountId);
        sockets.delete(accountId);
        if (stopping || !(await isAccountActive(accountId))) return;
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
        operationalLog("connection.closed", { account: accountLogRef(accountId), statusCode: typeof code === "number" ? code : undefined }, "error");
        if (code === DisconnectReason.loggedOut) {
          await updateConnection(accountId, { status: WhatsAppConnectionStatus.DISCONNECTED, qrCode: null, qrExpiresAt: null, lastError: "Sesión desvinculada." });
          await auditConnection(accountId, "WHATSAPP_DISCONNECTED");
          return;
        }
        await updateConnection(accountId, { status: WhatsAppConnectionStatus.ERROR, qrCode: null, qrExpiresAt: null, lastError: "Conexión interrumpida; reintentando." });
        await auditConnection(accountId, "WHATSAPP_CONNECTION_ERROR");
        setTimeout(() => void connect(accountId), 5_000);
      }
    });
  } catch (error) {
    connectedAccounts.delete(accountId);
    operationalLog("connection.start_failed", { account: accountLogRef(accountId), ...safeErrorInfo(error) }, "error");
    if (socket && sockets.get(accountId) === socket) sockets.delete(accountId);
    if (!stopping && await isAccountActive(accountId)) {
      await updateConnection(accountId, { status: WhatsAppConnectionStatus.ERROR, qrCode: null, qrExpiresAt: null, lastError: "No se pudo iniciar la conexión; se reintentará." });
      await auditConnection(accountId, "WHATSAPP_CONNECTION_ERROR");
      setTimeout(() => void connect(accountId), 5_000);
    }
  } finally { connecting.delete(accountId); }
}

async function syncAccounts() {
  const accounts = await prisma.whatsAppAccount.findMany({ where: { isActive: true }, select: { id: true, connection: { select: { status: true, relinkRequestId: true } } } });
  const allowed = new Set(accounts.map((account) => account.id));
  for (const account of accounts) {
    await resetAuthForExplicitRelink(account.id, account.connection?.relinkRequestId);
    const socket = sockets.get(account.id);
    if (socket && account.connection?.status === WhatsAppConnectionStatus.DISCONNECTED) {
      connectedAccounts.delete(account.id);
      sockets.delete(account.id);
      try { await socket.end(undefined); } catch { /* already closed */ }
    }
    void connect(account.id);
  }
  for (const [id, socket] of sockets) if (!allowed.has(id)) { connectedAccounts.delete(id); sockets.delete(id); try { await socket.end(undefined); } catch { /* already closed */ } }
}

async function processOutbound() {
  for (const [accountId, socket] of sockets) {
    if (!connectedAccounts.has(accountId)) {
      const now = Date.now();
      if (now - (lastBlockedOutboundLogAt.get(accountId) ?? 0) >= 30_000) {
        lastBlockedOutboundLogAt.set(accountId, now);
        const waiting = await prisma.outboundMessageRequest.findFirst({ where: { accountId, status: "PENDING" }, select: { id: true } }).catch(() => null);
        if (waiting) operationalLog("outbound.waiting_for_connection", { account: accountLogRef(accountId), request: safeLogRef(waiting.id) }, "debug");
      }
      continue;
    }
    let request: Awaited<ReturnType<typeof claimNextOutboundRequest>>;
    try { request = await claimNextOutboundRequest(accountId); }
    catch (error) { operationalLog("outbound.claim_failed", { account: accountLogRef(accountId), ...safeErrorInfo(error) }, "error"); continue; }
    if (!request) continue;
    const requestRef = safeLogRef(request.id);
    const destinationJid = outboundDestinationJid(request.conversation);
    if (!destinationJid) {
      operationalLog("outbound.destination_unavailable", { account: accountLogRef(accountId), request: requestRef }, "error");
      await failOutboundRequest(request, "No se pudo determinar un número de WhatsApp válido para esta conversación.").catch((error) => operationalLog("outbound.failure_persist_failed", { account: accountLogRef(accountId), request: requestRef, ...safeErrorInfo(error) }, "error"));
      continue;
    }
    try {
      operationalLog("outbound.relay_started", { account: accountLogRef(accountId), request: requestRef, destination: destinationKind(destinationJid) });
      const sent = await socket.sendMessage(destinationJid, { text: request.body });
      const externalId = sent?.key.id;
      if (!externalId) throw new Error("missing message id");
      operationalLog("outbound.relay_accepted", { account: accountLogRef(accountId), request: requestRef, message: safeLogRef(externalId), destination: destinationKind(destinationJid) });
      await completeOutboundRequest(request, externalId);
      operationalLog("outbound.persisted", { account: accountLogRef(accountId), request: requestRef, message: safeLogRef(externalId) });
      if (request.conversation.type === "DIRECT") void refreshContactProfilePicture(accountId, socket, destinationJid);
    } catch (error) {
      operationalLog("outbound.relay_failed", { account: accountLogRef(accountId), request: requestRef, destination: destinationKind(destinationJid), ...safeErrorInfo(error) }, "error");
      await failOutboundRequest(request).catch((failureError) => operationalLog("outbound.failure_persist_failed", { account: accountLogRef(accountId), request: requestRef, ...safeErrorInfo(failureError) }, "error"));
    }
  }
}

async function resetAuthForExplicitRelink(accountId: string, requestId: string | null | undefined) {
  if (!requestId || resettingAuth.has(accountId)) return false;
  resettingAuth.add(accountId);
  try {
    const socket = sockets.get(accountId);
    if (socket) {
      connectedAccounts.delete(accountId);
      sockets.delete(accountId);
      try { await socket.end(undefined); } catch { /* already closed */ }
    }
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
    if (!connectedAccounts.has(accountId)) continue;
    void recoverPendingMedia(accountId, socket);
  }
}

async function processReadReceipts() {
  for (const [accountId, socket] of sockets) {
    if (!connectedAccounts.has(accountId)) continue;
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

async function processHistoryRecovery() {
  for (const [accountId, socket] of sockets) {
    if (!connectedAccounts.has(accountId)) continue;
    await enqueueAccountWork(accountId, async () => {
      const request = await claimHistoryRecovery(accountId);
      if (!request) return;
      try { await requestHistoryPage(socket, request); } catch { await failHistoryRecovery(request); }
    });
  }
}

void syncAccounts();
const accountsTimer = setInterval(() => void syncAccounts(), 5_000);
const outboundTimer = setInterval(() => void processOutbound(), 1_500);
const mediaTimer = setInterval(() => void processPendingMedia(), 10_000);
const readReceiptTimer = setInterval(() => void processReadReceipts(), 2_000);
const historyRecoveryTimer = setInterval(() => void processHistoryRecovery(), 3_000);
async function shutdown() { stopping = true; clearInterval(accountsTimer); clearInterval(outboundTimer); clearInterval(mediaTimer); clearInterval(readReceiptTimer); clearInterval(historyRecoveryTimer); for (const socket of sockets.values()) try { await socket.end(undefined); } catch { /* ignore */ } await prisma.$disconnect(); process.exit(0); }
process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
