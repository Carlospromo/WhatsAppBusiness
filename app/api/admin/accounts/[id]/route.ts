import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { validCountry } from "@/lib/address-book";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params; const body = await request.json().catch(() => ({})); const country = validCountry(body.defaultPhoneCountry);
  if (!country) return NextResponse.json({ error: "País inválido" }, { status: 400 });
  const account = await prisma.whatsAppAccount.update({ where: { id }, data: { defaultPhoneCountry: country }, select: { id: true, defaultPhoneCountry: true } }).catch(() => null);
  if (!account) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
  await prisma.auditLog.create({ data: { userId: user.id, accountId: id, action: "ADDRESS_BOOK_COUNTRY_UPDATED", entity: "WhatsAppAccount", entityId: id } });
  return NextResponse.json(account);
}
