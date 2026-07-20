import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { prisma } from "@/lib/prisma";
import { validRecoveryRange } from "@/lib/history-recovery";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params;
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { accountId: true } });
  if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (!await canAccessAccount(user, conversation.accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const request = await prisma.historyRecoveryRequest.findFirst({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, pageCount: true, receivedCount: true, importedCount: true, duplicateCount: true, safeError: true, createdAt: true, completedAt: true } });
  return NextResponse.json({ request });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params; const body = await request.json().catch(() => ({})); const range = validRecoveryRange(body.from, body.to);
  if (!range) return NextResponse.json({ error: "Elige un rango válido de hasta 31 días, sin fechas futuras." }, { status: 400 });
  const conversation = await prisma.conversation.findUnique({ where: { id }, select: { accountId: true } });
  if (!conversation) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  if (!await canAccessAccount(user, conversation.accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const connection = await prisma.whatsAppConnection.findUnique({ where: { accountId: conversation.accountId }, select: { status: true } });
  if (connection?.status !== "CONNECTED") return NextResponse.json({ error: "WhatsApp debe estar conectado para recuperar historial." }, { status: 409 });
  const anchor = await prisma.message.findFirst({ where: { conversationId: id, sentAt: { gte: range.fromAt } }, orderBy: { sentAt: "desc" }, select: { externalId: true, sentAt: true, direction: true } });
  if (!anchor) return NextResponse.json({ error: "No hay un mensaje local posterior al inicio del rango que sirva de ancla para consultar el historial." }, { status: 409 });
  const recovery = await prisma.$transaction(async (transaction) => {
    const created = await transaction.historyRecoveryRequest.create({ data: { accountId: conversation.accountId, conversationId: id, requestedById: user.id, fromAt: range.fromAt, toAt: range.toAt, anchorExternalId: anchor.externalId, anchorSentAt: anchor.sentAt, anchorFromMe: anchor.direction === "OUTBOUND" }, select: { id: true, status: true } });
    await transaction.auditLog.create({ data: { accountId: conversation.accountId, userId: user.id, action: "HISTORY_RECOVERY_REQUESTED", entity: "HistoryRecoveryRequest", entityId: created.id } });
    return created;
  });
  return NextResponse.json({ request: recovery }, { status: 202 });
}
