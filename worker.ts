/* eslint-disable react-hooks/rules-of-hooks -- Baileys exports a state helper; this is a Node worker, not React. */
import "dotenv/config";
import { mkdir } from "node:fs/promises";
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { WhatsAppConnectionStatus } from "@prisma/client";
import { prisma } from "./lib/prisma";
import { auditConnection, updateConnection } from "./lib/whatsapp/connection";
import { maskPhone, normalizeWhatsAppMessage } from "./lib/whatsapp/normalize";
import { persistMessage, upsertContact } from "./lib/whatsapp/persistence";
import { claimNextOutboundRequest, completeOutboundRequest, failOutboundRequest } from "./lib/whatsapp/outbound";

const authDir = process.env.WA_AUTH_DIR || "/data/wa-auth";
let shuttingDown = false;
let queue = Promise.resolve();

function enqueue(work: () => Promise<void>) {
  queue = queue.then(work).catch(() => undefined);
  return queue;
}

async function connect() {
  await mkdir(authDir, { recursive: true });
  await updateConnection({ status: WhatsAppConnectionStatus.CONNECTING, qrCode: null, qrExpiresAt: null, lastError: null });
  await auditConnection("WHATSAPP_CONNECTING");
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();
  const socket = makeWASocket({ version, auth: state, printQRInTerminal: false, syncFullHistory: false, markOnlineOnConnect: false });
  socket.ev.on("creds.update", saveCreds);
  socket.ev.on("contacts.upsert", (contacts) => enqueue(async () => {
    for (const contact of contacts) if (contact.id) await upsertContact({ jid: contact.id, displayName: contact.name, pushName: contact.notify });
  }));
  socket.ev.on("contacts.update", (contacts) => enqueue(async () => {
    for (const contact of contacts) if (contact.id) await upsertContact({ jid: contact.id, displayName: contact.name, pushName: contact.notify });
  }));
  socket.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    void enqueue(async () => {
      for (const raw of messages) {
        const message = normalizeWhatsAppMessage(raw);
        if (message) await persistMessage(message);
      }
    });
  });
  socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      await updateConnection({ status: WhatsAppConnectionStatus.WAITING_FOR_QR, qrCode: qr, qrExpiresAt: new Date(Date.now() + 60_000) });
      await auditConnection("WHATSAPP_QR_AVAILABLE");
    }
    if (connection === "open") {
      const jid = socket.user?.id ?? null;
      await updateConnection({ status: WhatsAppConnectionStatus.CONNECTED, qrCode: null, qrExpiresAt: null, accountJid: jid, maskedPhone: maskPhone(jid), lastError: null });
      await auditConnection("WHATSAPP_CONNECTED");
    }
    if (connection === "close" && !shuttingDown) {
      const status = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        await updateConnection({ status: WhatsAppConnectionStatus.DISCONNECTED, qrCode: null, qrExpiresAt: null, lastError: "Sesión desvinculada." });
        await auditConnection("WHATSAPP_DISCONNECTED");
        return;
      }
      await updateConnection({ status: WhatsAppConnectionStatus.ERROR, qrCode: null, qrExpiresAt: null, lastError: "Conexión interrumpida; reintentando." });
      await auditConnection("WHATSAPP_CONNECTION_ERROR");
      setTimeout(() => { if (!shuttingDown) void connect(); }, 5_000);
    }
  });
  return socket;
}

let socket: Awaited<ReturnType<typeof connect>> | undefined;
void connect().then((instance) => { socket = instance; });
let processingOutbound = false;
async function processOutbound() {
  if (processingOutbound || !socket?.user) return;
  processingOutbound = true;
  try { const request = await claimNextOutboundRequest(); if (!request) return; try { const sent = await socket.sendMessage(request.conversation.jid, { text: request.body }); const externalId = sent?.key.id; if (!externalId) throw new Error("missing message id"); await completeOutboundRequest(request, externalId); } catch { await failOutboundRequest(request.id); } } finally { processingOutbound = false; }
}
const outboundTimer = setInterval(() => { void enqueue(processOutbound); }, 1_500);

async function shutdown() {
  shuttingDown = true;
  clearInterval(outboundTimer);
  try { await socket?.end(undefined); } catch { /* conexión ya cerrada */ }
  await prisma.$disconnect();
  process.exit(0);
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
