import { NextRequest, NextResponse } from "next/server";
import { AddressBookContactOrigin, AddressBookContactStatus } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { accountsForUser, canAccessAccount } from "@/lib/account";
import { canManageAddressBook } from "@/lib/authorization";
import { createManualAddressBookContact, validateManualAddressBookContact } from "@/lib/address-book";
import { listAddressBookContacts, parseAddressBookCursor } from "@/lib/address-book-list";
import { prisma } from "@/lib/prisma";

const origins = new Set(Object.values(AddressBookContactOrigin));
const statuses = new Set(Object.values(AddressBookContactStatus));

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const accountId = params.get("accountId") || undefined;
  if (accountId && !await canAccessAccount(user, accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const accounts = await accountsForUser(user);
  const allowed = accounts.filter((account) => account.isActive).map((account) => account.id);
  const origin = params.get("origin");
  const status = params.get("status");
  const conversation = params.get("conversation");
  const cursor = params.get("cursor");
  if (origin && !origins.has(origin as AddressBookContactOrigin)) return NextResponse.json({ error: "Filtro inválido" }, { status: 400 });
  if (status && !statuses.has(status as AddressBookContactStatus)) return NextResponse.json({ error: "Filtro inválido" }, { status: 400 });
  if (conversation && conversation !== "with" && conversation !== "without") return NextResponse.json({ error: "Filtro inválido" }, { status: 400 });
  if (cursor && !parseAddressBookCursor(cursor)) return NextResponse.json({ error: "Cursor inválido" }, { status: 400 });
  const result = await listAddressBookContacts({
    accountIds: allowed, accountId, q: params.get("q") || undefined,
    origin: origin as AddressBookContactOrigin | undefined,
    status: status as AddressBookContactStatus | undefined,
    conversation: conversation as "with" | "without" | undefined,
    cursor: parseAddressBookCursor(cursor),
  });
  return NextResponse.json({
    rows: result.rows.map((row) => ({
      id: row.id, account: row.account, displayName: row.displayName, lastName: row.lastName, company: row.company,
      origin: row.origin, status: row.status,
      phone: row.phones[0]?.normalizedPhone ? `•••• ${row.phones[0].normalizedPhone.slice(-4)}` : null,
      conversationId: row.whatsappContacts[0]?.conversations[0]?.id ?? null,
    })),
    total: result.total, nextCursor: result.nextCursor,
  });
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
  if (result.status === "EXISTS") return NextResponse.json({ error: "Ya existe un contacto manual o importado con ese teléfono.", id: result.id }, { status: 409 });
  await prisma.auditLog.create({ data: { userId: user.id, accountId, action: result.status === "CREATED" ? "ADDRESS_BOOK_CONTACT_MANUAL_CREATED" : "ADDRESS_BOOK_CONTACT_MANUAL_UPDATED", entity: "AddressBookContact", entityId: result.id } });
  return NextResponse.json({ id: result.id, status: result.status }, { status: result.status === "CREATED" ? 201 : 200 });
}
