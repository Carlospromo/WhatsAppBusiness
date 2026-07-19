import { prisma } from "@/lib/prisma";
import { AddressBookContactOrigin, MediaAttachmentStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { reconcileWhatsAppContact } from "@/lib/address-book";
import { encryptMediaSource } from "@/lib/media-encryption";
import { previewForMessage, type NormalizedMessage } from "./normalize";
import { messageRecordData } from "./message-record";

export async function upsertContact(accountId: string, contact: { jid: string; displayName?: string | null; pushName?: string | null }) {
  if (!contact.jid.endsWith("@s.whatsapp.net")) return;
  await reconcileWhatsAppContact(accountId, { ...contact, origin: AddressBookContactOrigin.WHATSAPP_SYNC });
}

export async function persistMessage(accountId: string, message: NormalizedMessage) {
  const contact = message.conversationType === "DIRECT"
    ? await reconcileWhatsAppContact(accountId, { jid: message.conversationJid, phoneJid: message.phoneJid, origin: message.direction === "INBOUND" ? AddressBookContactOrigin.EXTERNAL : AddressBookContactOrigin.WHATSAPP_SYNC })
    : null;
  // Identity metadata may arrive again with a replayed event. Reconcile it
  // before deduplicating the message so an existing LID contact gains its phone.
  const exists = await prisma.message.findUnique({ where: { accountId_externalId: { accountId, externalId: message.externalId } }, include: { mediaAttachments: { select: { id: true, status: true } } } });
  if (exists) return { created: false, mediaAttachment: exists.mediaAttachments[0] ?? null };
  try {
    return await prisma.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.upsert({
        where: { accountId_jid: { accountId, jid: message.conversationJid } },
        create: {
          accountId, jid: message.conversationJid,
          type: message.conversationType,
          contactId: contact?.id,
          lastMessageAt: message.sentAt,
          lastMessagePreview: previewForMessage(message),
          unreadCount: message.direction === "INBOUND" ? 1 : 0,
        },
        update: {
          contactId: contact?.id,
          lastMessageAt: message.sentAt,
          lastMessagePreview: previewForMessage(message),
          unreadCount: message.direction === "INBOUND" ? { increment: 1 } : undefined,
        },
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
            ...(message.media.source
              ? encryptMediaSource(message.media.source)
              : { status: MediaAttachmentStatus.UNAVAILABLE, safeError: "Archivo no disponible." }),
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
