import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canSendMessages } from "@/lib/authorization";
import { queueOutboundMessage, validateMessageBody } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";
import { canAccessAccount } from "@/lib/account";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canSendMessages(user.role)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const body = validateMessageBody((await request.json().catch(() => ({}))).body); if (!body) return NextResponse.json({ error: "Texto inválido" }, { status: 400 });
  const { id } = await params; const conversation = await prisma.conversation.findUnique({ where: { id }, select: { id: true, accountId: true } });
  if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (!await canAccessAccount(user, conversation.accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const queued = await queueOutboundMessage(id, conversation.accountId, user.id, body); await prisma.auditLog.create({ data: { accountId: conversation.accountId, userId: user.id, action: "OUTBOUND_REQUESTED", entity: "OutboundMessageRequest", entityId: queued.id } });
  return NextResponse.json({ id: queued.id, status: queued.status }, { status: 201 });
}
