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
import { processMediaAttachment, recoverPendingMedia } from "./lib/whatsapp/media";
import { claimNextReadReceiptRequest, completeReadReceiptRequest, failReadReceiptRequest, readReceiptKeys } from "./lib/whatsapp/read-receipts";
import { operationalLog, safeErrorInfo, safeLogRef } from "./lib/operational-log";

const authRoot = process.env.WA_AUTH_DIR || "/data/wa-auth";
let stopping = false;
const sockets = new Map<string, Awaited<ReturnType<typeof makeWASocket>>>();
const connecting = new Set<string>();
const resettingAuth = new Set<string>();
const accountQueues = new Map<string, Promise<void>>();

function authPath(accountId: string) { return `${authRoot}/${accountId}`; }

async function isAccountActive(accountId: string) {
  return Boolean(await prisma.whatsAppAccount.findFirst({ where: { id: accountId, isActive: true }, select: { id: true } }));
}

function enqueueAccountWork(accountId: string, work: () => Promise<void>) {
  const previous = accountQueues.get(accountId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work).catch(() => undefined);
  accountQueues.set(accountId, next);
  return next;
}

async function connect(accountId: string) {
  if (stopping || connecting.has(accountId) || sockets.has(accountId)) return;
  if (!(await isAccountActive(accountId))) return;
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
      printQRInTerminal: false,
      syncFullHistory: false,
      // The dashboard does not use WhatsApp properties, block lists or
      // privacy settings. Skipping these optional queries avoids their
      // one-minute timeout without affecting real-time messages or sending.
      fireInitQueries: false,
      markOnlineOnConnect: false,
    });
    socket = activeSocket;
    sockets.set(accountId, activeSocket);
    activeSocket.ev.on("creds.update", saveCreds);
    activeSocket.ev.on("contacts.upsert", (contacts) => void enqueueAccountWork(accountId, async () => { for (const contact of contacts) if (contact.id) await upsertContact(accountId, { jid: contact.id, displayName: contact.name, pushName: contact.notify }); }));
    activeSocket.ev.on("contacts.update", (contacts) => void enqueueAccountWork(accountId, async () => { for (const contact of contacts) if (contact.id) await upsertContact(accountId, { jid: contact.id, displayName: contact.name, pushName: contact.notify }); }));
    activeSocket.ev.on("messages.upsert", ({ messages, type }) => { if (type === "notify") void enqueueAccountWork(accountId, async () => { for (const raw of messages) { const message = normalizeWhatsAppMessage(raw); if (message) { const persisted = await persistMessage(accountId, message); if (persisted.mediaAttachment) await processMediaAttachment(accountId, persisted.mediaAttachment.id, activeSocket, raw); if (message.conversationType === "DIRECT") await refreshContactProfilePicture(accountId, activeSocket, message.conversationJid); } } }); });
    activeSocket.ev.on("messages.update", (updates) => {
      for (const update of updates) {
        const externalId = update.key.id;
        if (!update.key.fromMe || !externalId || update.update.status !== WAMessageStatus.ERROR) continue;
        operationalLog("outbound.delivery_rejected", { account: safeLogRef(accountId), message: safeLogRef(externalId) }, "error");
        void failOutboundDelivery(accountId, externalId).catch((error) => operationalLog("outbound.delivery_failure_persist_failed", { account: safeLogRef(accountId), message: safeLogRef(externalId), ...safeErrorInfo(error) }, "error"));
      }
    });
    activeSocket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (sockets.get(accountId) !== activeSocket) return;
      if (qr) { if (!(await isAccountActive(accountId))) { await activeSocket.end(undefined); return; } await updateConnection(accountId, { status: WhatsAppConnectionStatus.WAITING_FOR_QR, qrCode: qr, qrExpiresAt: new Date(Date.now() + 60_000) }); await auditConnection(accountId, "WHATSAPP_QR_AVAILABLE"); }
      if (connection === "open") { if (!(await isAccountActive(accountId))) { await activeSocket.end(undefined); return; } const jid = activeSocket.user?.id ?? null; await updateConnection(accountId, { status: WhatsAppConnectionStatus.CONNECTED, qrCode: null, qrExpiresAt: null, accountJid: jid, maskedPhone: maskPhone(jid), lastError: null }); await auditConnection(accountId, "WHATSAPP_CONNECTED"); void enqueueAccountWork(accountId, async () => { await refreshRecentContactProfilePictures(accountId, activeSocket); await recoverPendingMedia(accountId, activeSocket); }); }
      if (connection === "close") { sockets.delete(accountId); if (stopping || !(await isAccountActive(accountId))) return; const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode; if (code === DisconnectReason.loggedOut) { await updateConnection(accountId, { status: WhatsAppConnectionStatus.DISCONNECTED, qrCode: null, qrExpiresAt: null, lastError: "Sesión desvinculada." }); await auditConnection(accountId, "WHATSAPP_DISCONNECTED"); return; } await updateConnection(accountId, { status: WhatsAppConnectionStatus.ERROR, qrCode: null, qrExpiresAt: null, lastError: "Conexión interrumpida; reintentando." }); await auditConnection(accountId, "WHATSAPP_CONNECTION_ERROR"); setTimeout(() => void connect(accountId), 5_000); }
    });
  } catch {
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
      sockets.delete(account.id);
      try { await socket.end(undefined); } catch { /* already closed */ }
    }
    void connect(account.id);
  }
  for (const [id, socket] of sockets) if (!allowed.has(id)) { sockets.delete(id); try { await socket.end(undefined); } catch { /* already closed */ } }
}

async function processOutbound() {
  for (const [accountId, socket] of sockets) {
    if (!socket.user) continue;
    const request = await claimNextOutboundRequest(accountId);
    if (!request) continue;
    try { const sent = await socket.sendMessage(request.conversation.jid, { text: request.body }); const externalId = sent?.key.id; if (!externalId) throw new Error("missing message id"); await completeOutboundRequest(request, externalId); if (request.conversation.type === "DIRECT") try { await refreshContactProfilePicture(accountId, socket, request.conversation.jid); } catch { /* A profile picture must never change the outcome of an already sent message. */ } } catch { await failOutboundRequest(request.id); }
  }
}

async function resetAuthForExplicitRelink(accountId: string, requestId: string | null | undefined) {
  if (!requestId || resettingAuth.has(accountId)) return false;
  resettingAuth.add(accountId);
  try {
    const socket = sockets.get(accountId);
    if (socket) {
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

void syncAccounts();
const accountsTimer = setInterval(() => void syncAccounts(), 5_000);
const outboundTimer = setInterval(() => void processOutbound(), 1_500);
const mediaTimer = setInterval(() => void processPendingMedia(), 10_000);
const readReceiptTimer = setInterval(() => void processReadReceipts(), 2_000);
async function shutdown() { stopping = true; clearInterval(accountsTimer); clearInterval(outboundTimer); clearInterval(mediaTimer); clearInterval(readReceiptTimer); for (const socket of sockets.values()) try { await socket.end(undefined); } catch { /* ignore */ } await prisma.$disconnect(); process.exit(0); }
process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
