import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canManageMessages } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
import { canAccessAccount } from "@/lib/account";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canManageMessages(user.role)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { accountId: true } });
  if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (!await canAccessAccount(user, conversation.accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  await prisma.$transaction([prisma.message.updateMany({ where: { conversationId: id, direction: "INBOUND", isRead: false }, data: { isRead: true } }), prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } })]);
  return NextResponse.json({ ok: true });
}
