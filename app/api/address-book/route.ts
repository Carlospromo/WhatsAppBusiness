import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { accountsForUser, canAccessAccount } from "@/lib/account";
import { canManageAddressBook } from "@/lib/authorization";
import { createManualAddressBookContact, validateManualAddressBookContact } from "@/lib/address-book";
import { prisma } from "@/lib/prisma";

const take = 30;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const params = request.nextUrl.searchParams; const accountId = params.get("accountId") || undefined;
  if (accountId && !await canAccessAccount(user, accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const accounts = await accountsForUser(user); const allowed = accounts.filter((account) => account.isActive).map((account) => account.id);
  const q = params.get("q")?.trim().slice(0, 100); const origin = params.get("origin"); const status = params.get("status");
  if (origin && !["IMPORTED", "WHATSAPP_SYNC", "EXTERNAL", "MANUAL"].includes(origin)) return NextResponse.json({ error: "Filtro inválido" }, { status: 400 });
  if (status && !["VERIFIED", "EXTERNAL"].includes(status)) return NextResponse.json({ error: "Filtro inválido" }, { status: 400 });
  const cursor = params.get("cursor");
  const rows = await prisma.addressBookContact.findMany({ where: { accountId: accountId ?? { in: allowed }, ...(origin ? { origin: origin as never } : {}), ...(status ? { status: status as never } : {}), ...(q ? { OR: [{ displayName: { contains: q } }, { lastName: { contains: q } }, { company: { contains: q } }, { email: { contains: q } }, { phones: { some: { normalizedPhone: { contains: q.replace(/\s/g, "") } } } }] } : {}) }, include: { account: { select: { id: true, name: true } }, phones: { select: { normalizedPhone: true }, take: 1 }, whatsappContacts: { select: { conversations: { select: { id: true }, take: 1 } }, take: 1 } }, orderBy: [{ displayName: "asc" }, { id: "asc" }], take: take + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
  const next = rows.length > take ? rows.pop()!.id : null;
  return NextResponse.json({ rows: rows.map((row) => ({ id: row.id, account: row.account, displayName: row.displayName, lastName: row.lastName, company: row.company, origin: row.origin, status: row.status, phone: row.phones[0]?.normalizedPhone ? `•••• ${row.phones[0].normalizedPhone.slice(-4)}` : null, conversationId: row.whatsappContacts[0]?.conversations[0]?.id ?? null })), nextCursor: next });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canManageAddressBook(user.role)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const accountId = typeof body.accountId === "string" ? body.accountId : "";
  if (!accountId || !await canAccessAccount(user, accountId)) return NextResponse.json({ error: "Cuenta inválida" }, { status: 400 });
  if (body.confirmed !== true && body.confirmed !== "true") return NextResponse.json({ error: "Debes confirmar que dispones de legitimación para utilizar estos datos." }, { status: 400 });
  const account = await prisma.whatsAppAccount.findFirst({ where: { id: accountId, isActive: true }, select: { defaultPhoneCountry: true } });
  if (!account) return NextResponse.json({ error: "Cuenta inválida" }, { status: 400 });

  const input = validateManualAddressBookContact(body, account.defaultPhoneCountry);
  if (!input) return NextResponse.json({ error: "Nombre, teléfono, correo o formato inválido." }, { status: 400 });
  const result = await createManualAddressBookContact(accountId, user.id, input);
  if (result.status === "EXISTS") return NextResponse.json({ error: "Ya existe un contacto manual o importado con ese teléfono." }, { status: 409 });

  await prisma.auditLog.create({ data: { userId: user.id, accountId, action: result.status === "CREATED" ? "ADDRESS_BOOK_CONTACT_MANUAL_CREATED" : "ADDRESS_BOOK_CONTACT_MANUAL_UPDATED", entity: "AddressBookContact", entityId: result.id } });
  return NextResponse.json({ id: result.id, status: result.status }, { status: result.status === "CREATED" ? 201 : 200 });
}
