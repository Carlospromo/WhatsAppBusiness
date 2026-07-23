import { prisma } from "@/lib/prisma";
import { AddressBookContactOrigin, MediaAttachmentStatus, WhatsAppBridgeType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { reconcileWhatsAppContact } from "@/lib/address-book";
import { previewForMessage, phoneFromWebChatId, type NormalizedWebMessage } from "./normalize-web-message";
import { messageRecordData } from "./message-record";

export async function upsertContact(accountId: string, contact: { chatId: string; displayName?: string | null; pushName?: string | null }) {
  const phone = phoneFromWebChatId(contact.chatId);
  if (!phone) return;
  // Keep the legacy Contact model as a technical identity without rewriting
  // identifiers already persisted by the previous bridge.
  await reconcileWhatsAppContact(accountId, {
    jid: contact.chatId,
    phoneJid: contact.chatId,
    displayName: contact.displayName,
    pushName: contact.pushName,
    origin: AddressBookContactOrigin.WHATSAPP_SYNC,
  });
}

async function resolveConversation(accountId: string, message: NormalizedWebMessage, contactId: string | null | undefined) {
  const existingIdentity = await prisma.conversationExternalIdentity.findUnique({
    where: { accountId_bridgeType_externalChatId: { accountId, bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: message.conversationJid } },
    select: { conversationId: true },
  });
  if (existingIdentity) return prisma.conversation.findUniqueOrThrow({ where: { id: existingIdentity.conversationId } });

  const phone = message.conversationType === "DIRECT" ? phoneFromWebChatId(message.conversationJid) : null;
  const legacyConversation = phone
    ? await prisma.conversation.findFirst({
      where: { accountId, type: "DIRECT", OR: [{ contact: { phone } }, { contact: { addressBookContact: { phones: { some: { normalizedPhone: phone } } } } }] },
      orderBy: { lastMessageAt: "desc" },
    })
    : message.conversationType === "GROUP"
      ? await prisma.conversation.findFirst({ where: { accountId, jid: message.conversationJid } })
      : null;
  const conversation = legacyConversation ?? await prisma.conversation.create({
    data: { accountId, jid: message.conversationJid, type: message.conversationType, contactId: contactId ?? null },
  });
  await prisma.conversationExternalIdentity.upsert({
    where: { accountId_bridgeType_externalChatId: { accountId, bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: message.conversationJid } },
    create: { accountId, conversationId: conversation.id, bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: message.conversationJid, type: message.conversationType, normalizedPhone: phone },
    update: { normalizedPhone: phone },
  });
  return conversation;
}

export async function persistMessage(accountId: string, message: NormalizedWebMessage) {
  const contact = message.conversationType === "DIRECT"
    ? await reconcileWhatsAppContact(accountId, { jid: message.conversationJid, phoneJid: message.phoneJid, origin: message.direction === "INBOUND" ? AddressBookContactOrigin.EXTERNAL : AddressBookContactOrigin.WHATSAPP_SYNC })
    : null;
  // Identity metadata may arrive again with a replayed event. Reconcile it
  // before deduplicating the message so an existing LID contact gains its phone.
  const exists = await prisma.message.findUnique({ where: { accountId_externalId: { accountId, externalId: message.externalId } }, include: { mediaAttachments: { select: { id: true, status: true } } } });
  if (exists) return { created: false, mediaAttachment: exists.mediaAttachments[0] ?? null };
  try {
    return await prisma.$transaction(async (transaction) => {
      const conversation = await resolveConversation(accountId, message, contact?.id);
      await transaction.conversation.update({
        where: { id: conversation.id },
        data: { contactId: contact?.id ?? undefined, lastMessageAt: message.sentAt, lastMessagePreview: previewForMessage(message), unreadCount: message.direction === "INBOUND" ? { increment: 1 } : undefined },
      });
      const savedMessage = await transaction.message.create({ data: messageRecordData(accountId, conversation.id, message) });
      const mediaAttachment = message.media
        ? await transaction.mediaAttachment.create({
          data: {
            accountId,
            messageId: savedMessage.id,
            kind: message.media.kind,
            mimeType: message.media.mimeType,
            sizeBytes: message.media.declaredSize,
            width: message.media.width,
            height: message.media.height,
            durationSeconds: message.media.durationSeconds,
            objectKey: `accounts/${accountId}/messages/${savedMessage.id}/${randomUUID()}`,
            // Browser media is recovered by message id when available; never
            // persist WhatsApp download keys, URLs or raw media envelopes.
            status: MediaAttachmentStatus.PENDING,
          },
          select: { id: true, status: true },
        })
        : null;
      return { created: true, mediaAttachment };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { created: false, mediaAttachment: null };
    throw error;
  }
}
