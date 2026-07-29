import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requestedWebConnectionAction } from "@/lib/whatsapp/web-connection-action";
import { hasWebSessionProfile } from "@/lib/whatsapp/web-session";

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
  const sessionProfilePresent = await hasWebSessionProfile(account.id);
  return NextResponse.json({
    isActive: account.isActive,
    bridge: account.connection?.bridgeType ?? "WWEBJS",
    status: account.connection?.status ?? "DISCONNECTED",
    maskedPhone: account.connection?.maskedPhone ?? null,
    hasQr: Boolean(account.connection?.qrCode && account.connection.qrExpiresAt && account.connection.qrExpiresAt > new Date()),
    updatedAt: account.connection?.updatedAt ?? null,
    outboundRestricted: Boolean(account.connection?.outboundPausedAt && (!account.connection.outboundPauseEndsAt || account.connection.outboundPauseEndsAt > new Date())),
    sessionProfilePresent,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const payload = await request.json().catch(() => ({})) as { action?: unknown; relink?: unknown };
  // `relink` is retained only for backwards compatibility with an older UI.
  // Every non-destructive request now defaults to a retry; deleting LocalAuth
  // requires an explicit `action: "relink"` confirmation from the admin UI.
  const action = requestedWebConnectionAction(payload);
  const relink = action === "relink";
  const retry = action === "retry";
  const { id } = await params;
  const account = await prisma.whatsAppAccount.findUnique({ where: { id }, select: { id: true, isActive: true, connection: { select: { status: true, qrExpiresAt: true } } } });
  if (!account) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
  if (!account.isActive) return NextResponse.json({ error: "Activa la cuenta antes de vincularla" }, { status: 400 });
  if (account.connection?.status === "CONNECTED" && retry) return NextResponse.json({ error: "Esta cuenta ya está vinculada." }, { status: 409 });
  if (retry && account.connection?.status === "WAITING_FOR_QR" && account.connection.qrExpiresAt && account.connection.qrExpiresAt > new Date()) {
    return NextResponse.json({ ok: true, reusedQr: true });
  }

  if (retry) {
    if (!(await hasWebSessionProfile(account.id))) {
      return NextResponse.json({ error: "No hay una sesión guardada. Solicita una nueva vinculación para generar un QR." }, { status: 409 });
    }
    await prisma.whatsAppConnection.upsert({
      where: { accountId: id },
      create: { accountId: id, bridgeType: "WWEBJS", status: "CONNECTING" },
      update: { bridgeType: "WWEBJS", status: "CONNECTING", qrCode: null, qrExpiresAt: null, lastError: null, relinkRequestId: null },
    });
    await prisma.auditLog.create({ data: { userId: user.id, accountId: id, action: "WHATSAPP_WEB_CONNECTION_RETRY_REQUESTED", entity: "WhatsAppConnection", entityId: id } });
    return NextResponse.json({ ok: true, retrying: true });
  }

  // The worker consumes this marker and removes only this account's LocalAuth
  // profile. This destructive operation is reachable exclusively through the
  // explicit relink action above.
  const relinkRequestId = randomUUID();
  await prisma.whatsAppConnection.upsert({
    where: { accountId: id },
    create: { accountId: id, bridgeType: "WWEBJS", status: "DISCONNECTED", relinkRequestId },
    update: { bridgeType: "WWEBJS", status: "DISCONNECTED", qrCode: null, qrExpiresAt: null, lastError: null, relinkRequestId },
  });
  await prisma.auditLog.create({ data: { userId: user.id, accountId: id, action: relink ? "WHATSAPP_WEB_RELINK_REQUESTED" : "WHATSAPP_LINK_REQUESTED", entity: "WhatsAppConnection", entityId: id } });
  return NextResponse.json({ ok: true });
}
