import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canManageMessages } from "@/lib/authorization";
import { prisma } from "@/lib/prisma";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canManageMessages(user.role)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params;
  await prisma.$transaction([prisma.message.updateMany({ where: { conversationId: id, direction: "INBOUND", isRead: false }, data: { isRead: true } }), prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } })]);
  return NextResponse.json({ ok: true });
}
