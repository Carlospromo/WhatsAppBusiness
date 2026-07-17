import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await getCurrentUser()) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id }, include: { contact: true } });
  if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  const messages = await prisma.message.findMany({ where: { conversationId: id }, orderBy: { sentAt: "desc" }, take: 51 });
  return NextResponse.json({ conversation, messages: messages.slice(0, 50).reverse(), nextCursor: messages.length > 50 ? messages[50].id : null });
}
