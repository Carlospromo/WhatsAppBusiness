import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role === "VIEWER") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params; const body = await request.json().catch(() => ({})); const addressBookContactId = typeof body.addressBookContactId === "string" ? body.addressBookContactId : "";
  const contact = await prisma.contact.findUnique({ where: { id }, select: { id: true, accountId: true } }); const addressBook = await prisma.addressBookContact.findUnique({ where: { id: addressBookContactId }, select: { id: true, accountId: true } });
  if (!contact || !addressBook) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (contact.accountId !== addressBook.accountId || !await canAccessAccount(user, contact.accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  await prisma.contact.update({ where: { id }, data: { addressBookContactId } });
  await prisma.auditLog.create({ data: { userId: user.id, accountId: contact.accountId, action: "ADDRESS_BOOK_CONTACT_LINKED", entity: "Contact", entityId: id } });
  return NextResponse.json({ ok: true });
}
