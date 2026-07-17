import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canSendMessages } from "@/lib/authorization";
import { queueOutboundMessage, validateMessageBody } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canSendMessages(user.role)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const body = validateMessageBody((await request.json().catch(() => ({}))).body); if (!body) return NextResponse.json({ error: "Texto inválido" }, { status: 400 });
  const { id } = await params; const conversation = await prisma.conversation.findUnique({ where: { id }, select: { id: true } });
  if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  const queued = await queueOutboundMessage(id, user.id, body); await prisma.auditLog.create({ data: { userId: user.id, action: "OUTBOUND_REQUESTED", entity: "OutboundMessageRequest", entityId: queued.id } });
  return NextResponse.json({ id: queued.id, status: queued.status }, { status: 201 });
}
