import type { WAMessageKey } from "@whiskeysockets/baileys";
import { ReadReceiptStatus } from "@prisma/client";
import { prisma } from "../prisma";

const MAX_READ_RECEIPT_ATTEMPTS = 5;
const STALE_SENDING_AFTER_MS = 120_000;

type ReceiptMessage = {
  externalId: string;
  direction: "INBOUND" | "OUTBOUND";
  receiptParticipant: string | null;
};

type ReceiptConversation = { jid: string; type: "DIRECT" | "GROUP" };

export function receiptMessageIds(
  conversationType: ReceiptConversation["type"],
  messages: Array<{ id: string; receiptParticipant: string | null }>,
) {
  return [...new Set(messages
    .filter((message) => conversationType === "DIRECT" || Boolean(message.receiptParticipant))
    .map((message) => message.id))];
}

export function readReceiptKeys(conversation: ReceiptConversation, messages: ReceiptMessage[]): WAMessageKey[] {
  return messages.flatMap((message) => {
    if (message.direction !== "INBOUND" || !message.externalId) return [];
    if (conversation.type === "GROUP") {
      if (!message.receiptParticipant) return [];
      return [{ remoteJid: conversation.jid, id: message.externalId, participant: message.receiptParticipant }];
    }
    return [{ remoteJid: conversation.jid, id: message.externalId }];
  });
}

export function readReceiptRetryAt(lastAttemptAt: Date | null, attemptCount: number) {
  if (!lastAttemptAt || attemptCount <= 0) return new Date(0);
  const seconds = Math.min(60, 2 ** Math.min(attemptCount, 5));
  return new Date(lastAttemptAt.getTime() + seconds * 1_000);
}

export async function claimNextReadReceiptRequest(accountId: string) {
  // A process can stop after claiming a request and before Baileys confirms
  // it. Return only old claims to the durable queue on the next worker cycle.
  await prisma.readReceiptRequest.updateMany({
    where: {
      accountId,
      status: ReadReceiptStatus.SENDING,
      lastAttemptAt: { lt: new Date(Date.now() - STALE_SENDING_AFTER_MS) },
    },
    data: { status: ReadReceiptStatus.PENDING, safeError: "Pendiente de reintento." },
  });
  const candidates = await prisma.readReceiptRequest.findMany({
    where: { accountId, status: ReadReceiptStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take: 20,
    include: {
      conversation: { select: { jid: true, type: true } },
      messages: { include: { message: { select: { externalId: true, direction: true, receiptParticipant: true } } } },
    },
  });
  const request = candidates.find((candidate) => readReceiptRetryAt(candidate.lastAttemptAt, candidate.attemptCount) <= new Date());
  if (!request) return null;
  const claimed = await prisma.readReceiptRequest.updateMany({
    where: { id: request.id, status: ReadReceiptStatus.PENDING },
    data: { status: ReadReceiptStatus.SENDING, attemptCount: { increment: 1 }, lastAttemptAt: new Date(), safeError: null },
  });
  return claimed.count ? request : null;
}

export async function completeReadReceiptRequest(request: NonNullable<Awaited<ReturnType<typeof claimNextReadReceiptRequest>>>) {
  await prisma.$transaction([
    prisma.readReceiptRequest.update({ where: { id: request.id }, data: { status: ReadReceiptStatus.SENT, sentAt: new Date(), safeError: null } }),
    prisma.auditLog.create({ data: { accountId: request.accountId, userId: request.requestedById, action: "WHATSAPP_READ_RECEIPT_SENT", entity: "ReadReceiptRequest", entityId: request.id } }),
  ]);
}

export async function failReadReceiptRequest(request: NonNullable<Awaited<ReturnType<typeof claimNextReadReceiptRequest>>>) {
  const failed = request.attemptCount + 1 >= MAX_READ_RECEIPT_ATTEMPTS;
  await prisma.$transaction([
    prisma.readReceiptRequest.update({
      where: { id: request.id },
      data: {
        status: failed ? ReadReceiptStatus.FAILED : ReadReceiptStatus.PENDING,
        safeError: "No se pudo sincronizar la lectura con WhatsApp.",
      },
    }),
    ...(failed ? [prisma.auditLog.create({ data: { accountId: request.accountId, userId: request.requestedById, action: "WHATSAPP_READ_RECEIPT_FAILED", entity: "ReadReceiptRequest", entityId: request.id } })] : []),
  ]);
}
