import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validCountry } from "@/lib/address-book";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params; const body = await request.json().catch(() => ({}));
  const country = body.defaultPhoneCountry === undefined ? undefined : validCountry(body.defaultPhoneCountry);
  const isActive = typeof body.isActive === "boolean" ? body.isActive : undefined;
  if (body.defaultPhoneCountry !== undefined && !country) return NextResponse.json({ error: "País inválido" }, { status: 400 });
  if (country === undefined && isActive === undefined) return NextResponse.json({ error: "No hay cambios válidos" }, { status: 400 });
  const account = await prisma.whatsAppAccount.update({ where: { id }, data: { ...(country ? { defaultPhoneCountry: country } : {}), ...(isActive !== undefined ? { isActive } : {}) }, select: { id: true, name: true, isActive: true, defaultPhoneCountry: true } }).catch(() => null);
  if (!account) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
  if (isActive === false) await prisma.whatsAppConnection.updateMany({ where: { accountId: id }, data: { status: "DISCONNECTED", qrCode: null, qrExpiresAt: null } });
  await prisma.auditLog.create({ data: { userId: user.id, accountId: id, action: isActive === undefined ? "ADDRESS_BOOK_COUNTRY_UPDATED" : isActive ? "ACCOUNT_ACTIVATED" : "ACCOUNT_DEACTIVATED", entity: "WhatsAppAccount", entityId: id } });
  return NextResponse.json(account);
}
