import { prisma } from "@/lib/prisma";
import { AddressBookContactOrigin } from "@prisma/client";
import { reconcileWhatsAppContact } from "@/lib/address-book";
import type { NormalizedMessage } from "./normalize";
import { messageRecordData } from "./message-record";

export async function upsertContact(accountId: string, contact: { jid: string; displayName?: string | null; pushName?: string | null }) {
  if (!contact.jid.endsWith("@s.whatsapp.net")) return;
  await reconcileWhatsAppContact(accountId, { ...contact, origin: AddressBookContactOrigin.WHATSAPP_SYNC });
}

export async function persistMessage(accountId: string, message: NormalizedMessage) {
  const exists = await prisma.message.findUnique({ where: { accountId_externalId: { accountId, externalId: message.externalId } }, select: { id: true } });
  if (exists) return false;

  const contact = message.conversationType === "DIRECT"
    ? await reconcileWhatsAppContact(accountId, { jid: message.conversationJid, origin: message.direction === "INBOUND" ? AddressBookContactOrigin.EXTERNAL : AddressBookContactOrigin.WHATSAPP_SYNC })
    : null;
  try {
    await prisma.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.upsert({
        where: { accountId_jid: { accountId, jid: message.conversationJid } },
        create: {
          accountId, jid: message.conversationJid,
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
      await transaction.message.create({ data: messageRecordData(accountId, conversation.id, message) });
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return false;
    throw error;
  }
}
