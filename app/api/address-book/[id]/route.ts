import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { prisma } from "@/lib/prisma";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params; const contact = await prisma.addressBookContact.findUnique({ where: { id }, include: { account: { select: { id: true, name: true } }, phones: { select: { normalizedPhone: true, label: true } }, whatsappContacts: { select: { id: true, conversations: { select: { id: true } } } } } });
  if (!contact) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (!await canAccessAccount(user, contact.accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  return NextResponse.json(contact);
}
