import type { WAMessage, WAMessageKey, WASocket } from "@whiskeysockets/baileys";
import { HistoryRecoveryStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { normalizeWhatsAppMessage } from "./normalize";
import { persistMessage } from "./persistence";
export { validRecoveryRange } from "../history-recovery";

const PAGE_SIZE = 50;
const MAX_PAGES = 20;
const MAX_ATTEMPTS = 3;

export async function claimHistoryRecovery(accountId: string) {
  await prisma.historyRecoveryRequest.updateMany({ where: { accountId, status: HistoryRecoveryStatus.WAITING, lastAttemptAt: { lt: new Date(Date.now() - 45_000) } }, data: { status: HistoryRecoveryStatus.PENDING, baileysRequestId: null, safeError: "Pendiente de reintento." } });
  const request = await prisma.historyRecoveryRequest.findFirst({ where: { accountId, status: HistoryRecoveryStatus.PENDING }, orderBy: { createdAt: "asc" }, include: { conversation: { select: { jid: true } } } });
  if (!request) return null;
  const claimed = await prisma.historyRecoveryRequest.updateMany({ where: { id: request.id, status: HistoryRecoveryStatus.PENDING }, data: { status: HistoryRecoveryStatus.WAITING, attemptCount: { increment: 1 }, lastAttemptAt: new Date(), safeError: null } });
  return claimed.count ? request : null;
}

export async function requestHistoryPage(socket: WASocket, request: NonNullable<Awaited<ReturnType<typeof claimHistoryRecovery>>>) {
  const key: WAMessageKey = { remoteJid: request.conversation.jid, id: request.anchorExternalId, fromMe: request.anchorFromMe };
  const requestId = await socket.fetchMessageHistory(PAGE_SIZE, key, Math.floor(request.anchorSentAt.getTime() / 1000));
  await prisma.historyRecoveryRequest.update({ where: { id: request.id }, data: { baileysRequestId: requestId } });
}

export async function failHistoryRecovery(request: NonNullable<Awaited<ReturnType<typeof claimHistoryRecovery>>>) {
  const failed = request.attemptCount + 1 >= MAX_ATTEMPTS;
  await prisma.$transaction([
    prisma.historyRecoveryRequest.update({ where: { id: request.id }, data: { status: failed ? HistoryRecoveryStatus.FAILED : HistoryRecoveryStatus.PENDING, baileysRequestId: null, safeError: "No se pudo recuperar el historial solicitado." } }),
    ...(failed ? [prisma.auditLog.create({ data: { accountId: request.accountId, userId: request.requestedById, action: "HISTORY_RECOVERY_FAILED", entity: "HistoryRecoveryRequest", entityId: request.id } })] : []),
  ]);
}

export async function applyHistoryRecoveryPage(accountId: string, requestId: string | null | undefined, rawMessages: WAMessage[]) {
  if (!requestId) return;
  const request = await prisma.historyRecoveryRequest.findFirst({ where: { accountId, baileysRequestId: requestId, status: HistoryRecoveryStatus.WAITING }, include: { conversation: { select: { jid: true } } } });
  if (!request) return;
  const normalized = rawMessages.map((raw) => normalizeWhatsAppMessage(raw)).filter((message): message is NonNullable<typeof message> => Boolean(message && message.conversationJid === request.conversation.jid));
  const withinRange = normalized.filter((message) => message.sentAt >= request.fromAt && message.sentAt <= request.toAt && Boolean(message.body));
  let imported = 0;
  for (const message of withinRange) {
    const saved = await persistMessage(accountId, { ...message, media: undefined, messageType: "text" }, { includeMedia: false });
    if (saved.created) imported += 1;
  }
  const oldest = normalized.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())[0];
  const reachedStart = !oldest || oldest.sentAt <= request.fromAt || request.pageCount + 1 >= MAX_PAGES || oldest.externalId === request.anchorExternalId;
  await prisma.$transaction([
    prisma.historyRecoveryRequest.update({ where: { id: request.id }, data: reachedStart ? {
      status: HistoryRecoveryStatus.COMPLETED, completedAt: new Date(), baileysRequestId: null, pageCount: { increment: 1 }, receivedCount: { increment: normalized.length }, importedCount: { increment: imported }, duplicateCount: { increment: withinRange.length - imported }, safeError: null,
    } : {
      status: HistoryRecoveryStatus.PENDING, baileysRequestId: null, anchorExternalId: oldest.externalId, anchorSentAt: oldest.sentAt, anchorFromMe: oldest.direction === "OUTBOUND", pageCount: { increment: 1 }, receivedCount: { increment: normalized.length }, importedCount: { increment: imported }, duplicateCount: { increment: withinRange.length - imported }, safeError: null,
    } }),
    ...(reachedStart ? [prisma.auditLog.create({ data: { accountId, userId: request.requestedById, action: "HISTORY_RECOVERY_COMPLETED", entity: "HistoryRecoveryRequest", entityId: request.id } })] : []),
  ]);
}
