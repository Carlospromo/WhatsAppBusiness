import { Role } from "@prisma/client";
import { prisma } from "./prisma";

export function validAccountSlug(value: unknown) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 60 ? value : null;
}

export function validAccountName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  return name && name.length <= 80 ? name : null;
}

export async function canAccessAccount(user: { id: string; role: Role }, accountId: string) {
  if (user.role === Role.ADMIN) return Boolean(await prisma.whatsAppAccount.findFirst({ where: { id: accountId, isActive: true }, select: { id: true } }));
  return Boolean(await prisma.whatsAppAccountMembership.findFirst({ where: { accountId, userId: user.id, account: { isActive: true } }, select: { accountId: true } }));
}

export async function requireAccount(user: { id: string; role: Role }, accountId: string) {
  return (await canAccessAccount(user, accountId)) ? accountId : null;
}

export async function accountsForUser(user: { id: string; role: Role }) {
  return prisma.whatsAppAccount.findMany({
    where: user.role === Role.ADMIN ? {} : { memberships: { some: { userId: user.id } } },
    select: { id: true, name: true, slug: true, isActive: true, connection: { select: { status: true, maskedPhone: true, updatedAt: true } } },
    orderBy: { name: "asc" },
  });
}

export async function conversationForAccount(id: string, accountId: string) {
  return prisma.conversation.findFirst({ where: { id, accountId }, include: { contact: true, account: { select: { id: true, name: true, slug: true } } } });
}

export async function conversationForUser(user: { id: string; role: Role }, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, accountId: true, assignedToId: true },
  });
  if (!conversation || !await canAccessAccount(user, conversation.accountId)) return null;
  return conversation;
}
