import { OutboundMessageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { persistMessage } from "./persistence";

export async function claimNextOutboundRequest(accountId: string) {
  const request = await prisma.outboundMessageRequest.findFirst({
    where: { accountId, status: OutboundMessageStatus.PENDING },
    orderBy: { createdAt: "asc" },
    include: { conversation: { include: { contact: { select: { phone: true } } } }, },
  });
  if (!request) return null;
  const claimed = await prisma.outboundMessageRequest.updateMany({ where: { id: request.id, status: OutboundMessageStatus.PENDING }, data: { status: OutboundMessageStatus.SENDING } });
  return claimed.count ? request : null;
}
export async function completeOutboundRequest(request: NonNullable<Awaited<ReturnType<typeof claimNextOutboundRequest>>>, externalId: string) {
  await persistMessage(request.accountId, { externalId, conversationJid: request.conversation.jid, conversationType: request.conversation.type, direction: "OUTBOUND", senderJid: request.conversation.jid, body: request.body, messageType: "text", sentAt: new Date() });
  await prisma.$transaction([prisma.outboundMessageRequest.update({ where: { id: request.id }, data: { status: OutboundMessageStatus.SENT, externalId, sentAt: new Date(), safeError: null } }), prisma.auditLog.create({ data: { accountId: request.accountId, userId: request.requestedById, action: "OUTBOUND_SENT", entity: "OutboundMessageRequest", entityId: request.id } })]);
}
export async function failOutboundRequest(request: NonNullable<Awaited<ReturnType<typeof claimNextOutboundRequest>>>, safeError = "No se pudo enviar el mensaje.") {
  await prisma.$transaction([
    prisma.outboundMessageRequest.update({ where: { id: request.id }, data: { status: OutboundMessageStatus.FAILED, safeError } }),
    prisma.auditLog.create({ data: { accountId: request.accountId, userId: request.requestedById, action: "OUTBOUND_FAILED", entity: "OutboundMessageRequest", entityId: request.id } }),
  ]);
}

/**
 * Baileys may report a delivery rejection after sendMessage has returned.
 * Keep only a generic result: raw WhatsApp error codes can identify a device.
 */
export async function failOutboundDelivery(accountId: string, externalId: string) {
  const request = await prisma.outboundMessageRequest.findFirst({
    where: { accountId, externalId, status: OutboundMessageStatus.SENT },
    select: { id: true, requestedById: true },
  });
  if (!request) return;
  await prisma.$transaction([
    prisma.outboundMessageRequest.update({ where: { id: request.id }, data: { status: OutboundMessageStatus.FAILED, safeError: "WhatsApp no pudo entregar el mensaje." } }),
    prisma.auditLog.create({ data: { accountId, userId: request.requestedById, action: "OUTBOUND_DELIVERY_FAILED", entity: "OutboundMessageRequest", entityId: request.id } }),
  ]);
}
