import { ConversationType, MessageDirection, OutboundMessageStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { visibleConversation } from "./conversation-identity";

const pageSize = 30;
const textLimit = 2000;

export function parseCursor(value: string | null) {
  return value && /^[a-zA-Z0-9_-]{10,40}$/.test(value) ? value : undefined;
}

export function messagesFromNewestPage<T extends { id: string }>(results: T[], pageSize = 50) {
  const newest = results.slice(0, pageSize);
  return {
    messages: [...newest].reverse(),
    nextCursor: results.length > pageSize ? newest[newest.length - 1]?.id ?? null : null,
  };
}

export function validateMessageBody(value: unknown) {
  if (typeof value !== "string") return null;
  const body = value.trim();
  return body.length > 0 && body.length <= textLimit ? body : null;
}

export function directConversationJid(normalizedPhone: string) {
  return /^\+[1-9]\d{6,14}$/.test(normalizedPhone) ? `${normalizedPhone.slice(1)}@s.whatsapp.net` : null;
}

export async function listConversations(query: { accountIds: string[]; accountId?: string; search?: string; filter?: string; cursor?: string }) {
  const search = query.search?.trim().slice(0, 100);
  const where = {
    accountId: query.accountId ?? { in: query.accountIds },
    ...(query.filter === "unread" ? { unreadCount: { gt: 0 } } : {}),
    ...(query.filter === "direct" ? { type: ConversationType.DIRECT } : {}),
    ...(query.filter === "group" ? { type: ConversationType.GROUP } : {}),
    ...(search ? { OR: [{ contact: { displayName: { contains: search } } }, { contact: { pushName: { contains: search } } }, { contact: { phone: { contains: search } } }, { contact: { addressBookContact: { displayName: { contains: search } } } }] } : {}),
  };
  const rows = await prisma.conversation.findMany({
    where,
    select: {
      id: true,
      accountId: true,
      jid: true,
      type: true,
      lastMessageAt: true,
      lastMessagePreview: true,
      unreadCount: true,
      contact: { select: { id: true, displayName: true, pushName: true, phone: true, profilePictureUpdatedAt: true, addressBookContact: { select: { displayName: true, origin: true } } } },
      account: { select: { id: true, name: true, slug: true } },
    },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const next = rows.length > pageSize ? rows.pop()!.id : null;
  return { rows: rows.map(visibleConversation), nextCursor: next };
}

export async function queueOutboundMessage(conversationId: string, accountId: string, userId: string, body: string) {
  return prisma.outboundMessageRequest.create({ data: { accountId, conversationId, requestedById: userId, body, status: OutboundMessageStatus.PENDING } });
}

export async function createDirectConversationAndQueue(accountId: string, userId: string, normalizedPhone: string, body: string) {
  const jid = directConversationJid(normalizedPhone);
  if (!jid) return null;
  const knownPhone = await prisma.addressBookPhone.findUnique({ where: { accountId_normalizedPhone: { accountId, normalizedPhone } }, include: { addressBookContact: { select: { displayName: true } } } });
  return prisma.$transaction(async (transaction) => {
    const contact = await transaction.contact.upsert({
      where: { accountId_jid: { accountId, jid } },
      create: { accountId, jid, phone: normalizedPhone, displayName: knownPhone?.addressBookContact.displayName ?? null, addressBookContactId: knownPhone?.addressBookContactId ?? null },
      update: { phone: normalizedPhone, displayName: knownPhone?.addressBookContact.displayName ?? undefined, addressBookContactId: knownPhone?.addressBookContactId ?? undefined, syncedAt: new Date() },
    });
    const conversation = await transaction.conversation.upsert({
      where: { accountId_jid: { accountId, jid } },
      create: { accountId, jid, type: ConversationType.DIRECT, contactId: contact.id },
      update: { contactId: contact.id },
    });
    const request = await transaction.outboundMessageRequest.create({ data: { accountId, conversationId: conversation.id, requestedById: userId, body, status: OutboundMessageStatus.PENDING } });
    return { conversation, request };
  });
}

export { MessageDirection, OutboundMessageStatus };
