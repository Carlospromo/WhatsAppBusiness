import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params; const body = await request.json().catch(() => ({})); const userId = typeof body.userId === "string" ? body.userId : ""; const enabled = typeof body.enabled === "boolean" ? body.enabled : null;
  const target = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } }); const account = await prisma.whatsAppAccount.findUnique({ where: { id }, select: { id: true } });
  if (!target || !account || enabled === null) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  if (enabled) await prisma.whatsAppAccountMembership.upsert({ where: { accountId_userId: { accountId: id, userId } }, create: { accountId: id, userId }, update: {} });
  else await prisma.whatsAppAccountMembership.deleteMany({ where: { accountId: id, userId } });
  await prisma.auditLog.create({ data: { userId: user.id, accountId: id, action: enabled ? "ACCOUNT_MEMBER_GRANTED" : "ACCOUNT_MEMBER_REVOKED", entity: "WhatsAppAccountMembership", entityId: userId } });
  return NextResponse.json({ ok: true });
}
