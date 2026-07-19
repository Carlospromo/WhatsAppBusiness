import { ConversationType, MessageDirection, OutboundMessageStatus } from "@prisma/client";
import { prisma } from "./prisma";

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

export async function listConversations(query: { accountIds: string[]; accountId?: string; search?: string; filter?: string; cursor?: string }) {
  const search = query.search?.trim().slice(0, 100);
  const where = {
    accountId: query.accountId ?? { in: query.accountIds },
    ...(query.filter === "unread" ? { unreadCount: { gt: 0 } } : {}),
    ...(query.filter === "direct" ? { type: ConversationType.DIRECT } : {}),
    ...(query.filter === "group" ? { type: ConversationType.GROUP } : {}),
    ...(search ? { OR: [{ contact: { displayName: { contains: search } } }, { contact: { pushName: { contains: search } } }, { contact: { phone: { contains: search } } }, { contact: { addressBookContact: { displayName: { contains: search } } } }] } : {}),
  };
  const rows = await prisma.conversation.findMany({ where, include: { contact: { include: { addressBookContact: true } }, account: { select: { id: true, name: true, slug: true } } }, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], take: pageSize + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
  const next = rows.length > pageSize ? rows.pop()!.id : null;
  return { rows, nextCursor: next };
}

export async function queueOutboundMessage(conversationId: string, accountId: string, userId: string, body: string) {
  return prisma.outboundMessageRequest.create({ data: { accountId, conversationId, requestedById: userId, body, status: OutboundMessageStatus.PENDING } });
}

export { MessageDirection, OutboundMessageStatus };
