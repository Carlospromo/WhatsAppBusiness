import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params;
  const account = await prisma.whatsAppAccount.findUnique({
    where: { id },
    include: { connection: { select: { status: true, bridgeType: true, maskedPhone: true, updatedAt: true, qrCode: true, qrExpiresAt: true, outboundPausedAt: true, outboundPauseEndsAt: true } } },
  });
  if (!account) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  return NextResponse.json({
    isActive: account.isActive,
    bridge: account.connection?.bridgeType ?? "WWEBJS",
    status: account.connection?.status ?? "DISCONNECTED",
    maskedPhone: account.connection?.maskedPhone ?? null,
    hasQr: Boolean(account.connection?.qrCode && account.connection.qrExpiresAt && account.connection.qrExpiresAt > new Date()),
    updatedAt: account.connection?.updatedAt ?? null,
    outboundRestricted: Boolean(account.connection?.outboundPausedAt && (!account.connection.outboundPauseEndsAt || account.connection.outboundPauseEndsAt > new Date())),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const payload = await request.json().catch(() => ({})) as { relink?: unknown };
  const relink = payload.relink === true;
  const { id } = await params;
  const account = await prisma.whatsAppAccount.findUnique({ where: { id }, select: { id: true, isActive: true, connection: { select: { status: true, qrExpiresAt: true } } } });
  if (!account) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
  if (!account.isActive) return NextResponse.json({ error: "Activa la cuenta antes de vincularla" }, { status: 400 });
  if (account.connection?.status === "CONNECTED" && !relink) return NextResponse.json({ error: "Esta cuenta ya está vinculada." }, { status: 409 });
  if (!relink && account.connection?.status === "WAITING_FOR_QR" && account.connection.qrExpiresAt && account.connection.qrExpiresAt > new Date()) {
    return NextResponse.json({ ok: true, reusedQr: true });
  }

  // The worker consumes this marker, destroys this account's browser client and
  // removes only its LocalAuth profile after the administrator confirmation.
  const relinkRequestId = randomUUID();
  await prisma.whatsAppConnection.upsert({
    where: { accountId: id },
    create: { accountId: id, bridgeType: "WWEBJS", status: "DISCONNECTED", relinkRequestId },
    update: { bridgeType: "WWEBJS", status: "DISCONNECTED", qrCode: null, qrExpiresAt: null, lastError: null, relinkRequestId },
  });
  await prisma.auditLog.create({ data: { userId: user.id, accountId: id, action: relink ? "WHATSAPP_WEB_RELINK_REQUESTED" : "WHATSAPP_LINK_REQUESTED", entity: "WhatsAppConnection", entityId: id } });
  return NextResponse.json({ ok: true });
}
