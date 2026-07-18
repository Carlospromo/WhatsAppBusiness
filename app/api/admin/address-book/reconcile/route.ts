import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { reconcileExistingContacts } from "@/lib/address-book";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const body = await request.json().catch(() => ({})); const accountId = typeof body.accountId === "string" ? body.accountId : "";
  if (!accountId || !await canAccessAccount(user, accountId)) return NextResponse.json({ error: "Cuenta inválida" }, { status: 400 });
  const result = await reconcileExistingContacts(accountId);
  await prisma.auditLog.create({ data: { userId: user.id, accountId, action: "ADDRESS_BOOK_RECONCILED", entity: "AddressBookContact", metadata: JSON.stringify(result) } });
  return NextResponse.json(result);
}
