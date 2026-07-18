/* eslint-disable react-hooks/rules-of-hooks -- Baileys exports a state helper; this is a Node worker. */
/* WhatsApp worker: every account owns an isolated socket and auth directory. */
import "dotenv/config";
import { mkdir } from "node:fs/promises";
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { WhatsAppConnectionStatus } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { auditConnection, updateConnection } from "./lib/whatsapp/connection";
import { maskPhone, normalizeWhatsAppMessage } from "./lib/whatsapp/normalize";
import { persistMessage, upsertContact } from "./lib/whatsapp/persistence";
import { claimNextOutboundRequest, completeOutboundRequest, failOutboundRequest } from "./lib/whatsapp/outbound";

const authRoot = process.env.WA_AUTH_DIR || "/data/wa-auth";
let stopping = false;
const sockets = new Map<string, Awaited<ReturnType<typeof makeWASocket>>>();
const connecting = new Set<string>();
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
  try {
    await mkdir(authPath(accountId), { recursive: true });
    await updateConnection(accountId, { status: WhatsAppConnectionStatus.CONNECTING, qrCode: null, qrExpiresAt: null, lastError: null });
    const { state, saveCreds } = await useMultiFileAuthState(authPath(accountId));
    const { version } = await fetchLatestBaileysVersion();
    const socket = makeWASocket({ version, auth: state, printQRInTerminal: false, syncFullHistory: false, markOnlineOnConnect: false });
    sockets.set(accountId, socket);
    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("contacts.upsert", (contacts) => void enqueueAccountWork(accountId, async () => { for (const contact of contacts) if (contact.id) await upsertContact(accountId, { jid: contact.id, displayName: contact.name, pushName: contact.notify }); }));
    socket.ev.on("contacts.update", (contacts) => void enqueueAccountWork(accountId, async () => { for (const contact of contacts) if (contact.id) await upsertContact(accountId, { jid: contact.id, displayName: contact.name, pushName: contact.notify }); }));
    socket.ev.on("messages.upsert", ({ messages, type }) => { if (type === "notify") void enqueueAccountWork(accountId, async () => { for (const raw of messages) { const message = normalizeWhatsAppMessage(raw); if (message) await persistMessage(accountId, message); } }); });
    socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) { if (!(await isAccountActive(accountId))) { await socket.end(undefined); return; } await updateConnection(accountId, { status: WhatsAppConnectionStatus.WAITING_FOR_QR, qrCode: qr, qrExpiresAt: new Date(Date.now() + 60_000) }); await auditConnection(accountId, "WHATSAPP_QR_AVAILABLE"); }
      if (connection === "open") { if (!(await isAccountActive(accountId))) { await socket.end(undefined); return; } const jid = socket.user?.id ?? null; await updateConnection(accountId, { status: WhatsAppConnectionStatus.CONNECTED, qrCode: null, qrExpiresAt: null, accountJid: jid, maskedPhone: maskPhone(jid), lastError: null }); await auditConnection(accountId, "WHATSAPP_CONNECTED"); }
      if (connection === "close") { sockets.delete(accountId); if (stopping || !(await isAccountActive(accountId))) return; const code = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode; if (code === DisconnectReason.loggedOut) { await updateConnection(accountId, { status: WhatsAppConnectionStatus.DISCONNECTED, qrCode: null, qrExpiresAt: null, lastError: "Sesión desvinculada." }); await auditConnection(accountId, "WHATSAPP_DISCONNECTED"); return; } await updateConnection(accountId, { status: WhatsAppConnectionStatus.ERROR, qrCode: null, qrExpiresAt: null, lastError: "Conexión interrumpida; reintentando." }); await auditConnection(accountId, "WHATSAPP_CONNECTION_ERROR"); setTimeout(() => void connect(accountId), 5_000); }
    });
  } finally { connecting.delete(accountId); }
}

async function syncAccounts() {
  const accounts = await prisma.whatsAppAccount.findMany({ where: { isActive: true }, select: { id: true } });
  const allowed = new Set(accounts.map((account) => account.id));
  for (const account of accounts) void connect(account.id);
  for (const [id, socket] of sockets) if (!allowed.has(id)) { sockets.delete(id); try { await socket.end(undefined); } catch { /* already closed */ } }
}

async function processOutbound() {
  for (const [accountId, socket] of sockets) {
    if (!socket.user) continue;
    const request = await claimNextOutboundRequest(accountId);
    if (!request) continue;
    try { const sent = await socket.sendMessage(request.conversation.jid, { text: request.body }); const externalId = sent?.key.id; if (!externalId) throw new Error("missing message id"); await completeOutboundRequest(request, externalId); } catch { await failOutboundRequest(request.id); }
  }
}

void syncAccounts();
const accountsTimer = setInterval(() => void syncAccounts(), 15_000);
const outboundTimer = setInterval(() => void processOutbound(), 1_500);
async function shutdown() { stopping = true; clearInterval(accountsTimer); clearInterval(outboundTimer); for (const socket of sockets.values()) try { await socket.end(undefined); } catch { /* ignore */ } await prisma.$disconnect(); process.exit(0); }
process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
