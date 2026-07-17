import { prisma } from "@/lib/prisma";
import type { NormalizedMessage } from "./normalize";

export async function upsertContact(contact: { jid: string; displayName?: string | null; pushName?: string | null }) {
  if (!contact.jid.endsWith("@s.whatsapp.net")) return;
  const phone = contact.jid.split("@")[0].replace(/\D/g, "") || null;
  await prisma.contact.upsert({
    where: { jid: contact.jid },
    create: { jid: contact.jid, phone, displayName: contact.displayName ?? null, pushName: contact.pushName ?? null },
    update: { phone, displayName: contact.displayName ?? undefined, pushName: contact.pushName ?? undefined, syncedAt: new Date() },
  });
}

export async function persistMessage(message: NormalizedMessage) {
  const exists = await prisma.message.findUnique({ where: { externalId: message.externalId }, select: { id: true } });
  if (exists) return false;

  const contact = message.conversationType === "DIRECT"
    ? await prisma.contact.findUnique({ where: { jid: message.conversationJid }, select: { id: true } })
    : null;
  const conversation = await prisma.conversation.upsert({
    where: { jid: message.conversationJid },
    create: {
      jid: message.conversationJid,
      type: message.conversationType,
      contactId: contact?.id,
      lastMessageAt: message.sentAt,
      lastMessagePreview: message.body.slice(0, 240),
      unreadCount: message.direction === "INBOUND" ? 1 : 0,
    },
    update: {
      contactId: contact?.id,
      lastMessageAt: message.sentAt,
      lastMessagePreview: message.body.slice(0, 240),
      unreadCount: message.direction === "INBOUND" ? { increment: 1 } : undefined,
    },
  });
  try {
    await prisma.message.create({
      data: { ...message, conversationId: conversation.id, isRead: message.direction === "OUTBOUND" },
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}
