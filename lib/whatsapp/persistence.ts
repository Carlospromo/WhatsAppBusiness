import { prisma } from "@/lib/prisma";
import { AddressBookContactOrigin, ConversationType, MediaAttachmentStatus, WhatsAppBridgeType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { phoneFromJid, reconcileWhatsAppContact } from "@/lib/address-book";
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

export type IndexedWebChat = {
  chatId: string;
  type: ConversationType;
  timestamp: Date;
  displayName?: string | null;
};

/**
 * Indexes an already-existing WhatsApp Web chat without reading its message
 * history. This makes a linked account's recent chat list visible in the
 * inbox while keeping historical message import explicitly out of scope.
 */
export async function indexWebChat(accountId: string, chat: IndexedWebChat) {
  const phone = chat.type === ConversationType.DIRECT ? phoneFromWebChatId(chat.chatId) : null;
  const contact = phone
    ? await reconcileWhatsAppContact(accountId, {
      jid: chat.chatId,
      phoneJid: chat.chatId,
      displayName: chat.displayName,
      origin: AddressBookContactOrigin.WHATSAPP_SYNC,
    })
    : null;
  const existingIdentity = await prisma.conversationExternalIdentity.findUnique({
    where: { accountId_bridgeType_externalChatId: { accountId, bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: chat.chatId } },
    select: { conversationId: true },
  });
  const legacyConversation = existingIdentity
    ? await prisma.conversation.findUnique({ where: { id: existingIdentity.conversationId }, select: { id: true } })
    : phone
      ? await prisma.conversation.findFirst({
        where: { accountId, type: ConversationType.DIRECT, OR: [{ jid: chat.chatId }, { contact: { phone } }, { contact: { addressBookContact: { phones: { some: { normalizedPhone: phone } } } } }] },
        orderBy: { lastMessageAt: "desc" },
        select: { id: true },
      })
      : await prisma.conversation.findUnique({ where: { accountId_jid: { accountId, jid: chat.chatId } }, select: { id: true } });
  const conversation = legacyConversation ?? await prisma.conversation.create({
    data: { accountId, jid: chat.chatId, type: chat.type, contactId: contact?.id ?? null, lastMessageAt: chat.timestamp },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.conversationExternalIdentity.upsert({
      where: { accountId_bridgeType_externalChatId: { accountId, bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: chat.chatId } },
      create: { accountId, conversationId: conversation.id, bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: chat.chatId, type: chat.type, normalizedPhone: phone },
      update: { normalizedPhone: phone },
    }),
    prisma.conversation.updateMany({
      where: { id: conversation.id, OR: [{ lastMessageAt: null }, { lastMessageAt: { lt: chat.timestamp } }] },
      data: { lastMessageAt: chat.timestamp, contactId: contact?.id ?? undefined },
    }),
  ]);
  return { created: !legacyConversation, conversationId: conversation.id };
}

/**
 * An inbound WhatsApp Web chat can initially be addressed by an LID. Once the
 * bridge's public resolver supplies its matching phone identity, retain that
 * transport LID and attach the verified phone to the existing contact/thread.
 * No number is inferred from the LID and this never enumerates contacts.
 */
export async function linkLidContactToPhone(accountId: string, lidJid: string, phoneJid: string) {
  if (!lidJid.endsWith("@lid")) return null;
  const phone = phoneFromJid(phoneJid);
  if (!phone) return null;
  const contact = await reconcileWhatsAppContact(accountId, {
    jid: lidJid,
    phoneJid,
    origin: AddressBookContactOrigin.EXTERNAL,
  });
  await prisma.$transaction([
    prisma.conversationExternalIdentity.updateMany({
      where: { accountId, bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: lidJid },
      data: { normalizedPhone: phone },
    }),
    prisma.conversation.updateMany({
      where: {
        accountId,
        type: "DIRECT",
        OR: [
          { jid: lidJid },
          { externalIdentities: { some: { bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: lidJid } } },
        ],
      },
      data: { contactId: contact.id },
    }),
  ]);
  return contact;
}

type ConversationResolution = "BRIDGE_IDENTITY" | "LEGACY_PHONE" | "LEGACY_GROUP" | "NEW";

async function resolveConversation(accountId: string, message: NormalizedWebMessage, contactId: string | null | undefined): Promise<{ conversation: { id: string }; resolution: ConversationResolution }> {
  const existingIdentity = await prisma.conversationExternalIdentity.findUnique({
    where: { accountId_bridgeType_externalChatId: { accountId, bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: message.conversationJid } },
    select: { conversationId: true },
  });
  if (existingIdentity) return {
    conversation: await prisma.conversation.findUniqueOrThrow({ where: { id: existingIdentity.conversationId }, select: { id: true } }),
    resolution: "BRIDGE_IDENTITY",
  };

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
    select: { id: true },
  });
  await prisma.conversationExternalIdentity.upsert({
    where: { accountId_bridgeType_externalChatId: { accountId, bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: message.conversationJid } },
    create: { accountId, conversationId: conversation.id, bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: message.conversationJid, type: message.conversationType, normalizedPhone: phone },
    update: { normalizedPhone: phone },
  });
  return {
    conversation,
    resolution: legacyConversation
      ? phone ? "LEGACY_PHONE" : "LEGACY_GROUP"
      : "NEW",
  };
}

export async function persistMessage(accountId: string, message: NormalizedWebMessage) {
  const contact = message.conversationType === "DIRECT"
    ? await reconcileWhatsAppContact(accountId, { jid: message.conversationJid, phoneJid: message.phoneJid, origin: message.direction === "INBOUND" ? AddressBookContactOrigin.EXTERNAL : AddressBookContactOrigin.WHATSAPP_SYNC })
    : null;
  // Identity metadata may arrive again with a replayed event. Reconcile it
  // before deduplicating the message so an existing LID contact gains its phone.
  const exists = await prisma.message.findUnique({ where: { accountId_externalId: { accountId, externalId: message.externalId } }, include: { mediaAttachments: { select: { id: true, status: true } } } });
  if (exists) return { created: false, mediaAttachment: exists.mediaAttachments[0] ?? null, conversationResolution: "DUPLICATE" as const };
  try {
    return await prisma.$transaction(async (transaction) => {
      const { conversation, resolution } = await resolveConversation(accountId, message, contact?.id);
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
      return { created: true, mediaAttachment, conversationResolution: resolution };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return { created: false, mediaAttachment: null, conversationResolution: "DUPLICATE" as const };
    throw error;
  }
}
