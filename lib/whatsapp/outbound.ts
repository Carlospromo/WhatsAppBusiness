import { OutboundMessageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { persistMessage } from "./persistence";

export async function claimNextOutboundRequest(accountId: string) {
  const request = await prisma.outboundMessageRequest.findFirst({
    where: { accountId, status: OutboundMessageStatus.PENDING },
    orderBy: { createdAt: "asc" },
    include: { conversation: { include: { contact: { select: { phone: true } } } } },
  });
  if (!request) return null;
  const claimed = await prisma.outboundMessageRequest.updateMany({ where: { id: request.id, status: OutboundMessageStatus.PENDING }, data: { status: OutboundMessageStatus.SENDING } });
  return claimed.count ? request : null;
}
/** The return from sendMessage is only a local relay acceptance. */
export async function recordOutboundRelayAccepted(request: NonNullable<Awaited<ReturnType<typeof claimNextOutboundRequest>>>, externalId: string, destinationJid: string) {
  await persistMessage(request.accountId, { externalId, conversationJid: request.conversation.jid, conversationType: request.conversation.type, direction: "OUTBOUND", senderJid: destinationJid, body: request.body, messageType: "text", sentAt: new Date() });
  const updated = await prisma.outboundMessageRequest.updateMany({ where: { id: request.id, status: OutboundMessageStatus.SENDING }, data: { externalId, safeError: null } });
  if (updated.count) await prisma.auditLog.create({ data: { accountId: request.accountId, userId: request.requestedById, action: "OUTBOUND_RELAY_ACCEPTED", entity: "OutboundMessageRequest", entityId: request.id } });
}

export async function completeOutboundRequest(accountId: string, externalId: string) {
  const request = await prisma.outboundMessageRequest.findFirst({ where: { accountId, externalId, status: OutboundMessageStatus.SENDING }, select: { id: true, requestedById: true } });
  if (!request) return false;
  await prisma.$transaction([
    prisma.outboundMessageRequest.update({ where: { id: request.id }, data: { status: OutboundMessageStatus.SENT, sentAt: new Date(), safeError: null } }),
    prisma.auditLog.create({ data: { accountId, userId: request.requestedById, action: "OUTBOUND_SERVER_ACKNOWLEDGED", entity: "OutboundMessageRequest", entityId: request.id } }),
  ]);
  return true;
}

export async function failOutboundRequest(id: string, safeError = "No se pudo enviar el mensaje.") {
  await prisma.outboundMessageRequest.updateMany({ where: { id, status: OutboundMessageStatus.SENDING }, data: { status: OutboundMessageStatus.FAILED, safeError } });
}

/**
 * A local relay acknowledgement does not guarantee that WhatsApp can deliver
 * the encrypted message. Keep the request state truthful when Baileys later
 * reports a delivery error; raw WhatsApp codes are deliberately not exposed.
 */
export async function failOutboundDelivery(accountId: string, externalId: string) {
  const request = await prisma.outboundMessageRequest.findFirst({
    where: { accountId, externalId, status: { in: [OutboundMessageStatus.SENDING, OutboundMessageStatus.SENT] } },
    select: { id: true, requestedById: true },
  });
  if (!request) return;
  await prisma.$transaction([
    prisma.outboundMessageRequest.update({ where: { id: request.id }, data: { status: OutboundMessageStatus.FAILED, safeError: "WhatsApp no pudo entregar el mensaje." } }),
    prisma.auditLog.create({ data: { accountId, userId: request.requestedById, action: "OUTBOUND_DELIVERY_REJECTED", entity: "OutboundMessageRequest", entityId: request.id } }),
  ]);
}
