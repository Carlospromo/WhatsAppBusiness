import { NextRequest, NextResponse } from "next/server";
import { ContactImportItemAction } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { previewImport } from "@/lib/address-book";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const accountId = request.nextUrl.searchParams.get("accountId");
  if (accountId && !await canAccessAccount(user, accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  return NextResponse.json(await prisma.contactImport.findMany({ where: accountId ? { accountId } : {}, select: { id: true, accountId: true, status: true, safeFileName: true, totalRows: true, validRows: true, createdRows: true, updatedRows: true, skippedRows: true, errorRows: true, createdAt: true, appliedAt: true }, orderBy: { createdAt: "desc" }, take: 50 }));
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const form = await request.formData().catch(() => null); const accountId = form?.get("accountId"); const file = form?.get("file"); const confirmed = form?.get("confirmed") === "true";
  if (!confirmed || typeof accountId !== "string" || !(file instanceof File) || !await canAccessAccount(user, accountId)) return NextResponse.json({ error: "Datos de importación inválidos" }, { status: 400 });
  const account = await prisma.whatsAppAccount.findUnique({ where: { id: accountId }, select: { defaultPhoneCountry: true } });
  if (!account) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
  try {
    const preview = await previewImport(file.name, Buffer.from(await file.arrayBuffer()), account.defaultPhoneCountry);
    const phoneRows = preview.rows.filter((row) => row.normalizedPhone).map((row) => row.normalizedPhone!);
    const existing = await prisma.addressBookPhone.findMany({ where: { accountId, normalizedPhone: { in: phoneRows } }, select: { normalizedPhone: true } });
    const known = new Set(existing.map((row) => row.normalizedPhone));
    const rows = preview.rows.map((row) => ({ ...row, action: row.action === ContactImportItemAction.CREATE && row.normalizedPhone && known.has(row.normalizedPhone) ? ContactImportItemAction.UPDATE : row.action }));
    const importRecord = await prisma.contactImport.create({ data: { accountId, createdById: user.id, status: "PREVIEWED", safeFileName: file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "agenda", fileHash: preview.fileHash, totalRows: rows.length, validRows: rows.filter((row) => row.action !== ContactImportItemAction.ERROR).length, skippedRows: rows.filter((row) => row.action === ContactImportItemAction.SKIP).length, errorRows: rows.filter((row) => row.action === ContactImportItemAction.ERROR).length, previewedAt: new Date(), items: { create: rows.map((row) => ({ rowNumber: row.rowNumber, proposedName: row.name || null, proposedLastName: row.lastName, proposedEmail: row.email, proposedCompany: row.company, proposedTags: row.tags, normalizedPhone: row.normalizedPhone, action: row.action, safeError: row.safeError })) } } });
    await prisma.auditLog.create({ data: { userId: user.id, accountId, action: "ADDRESS_BOOK_IMPORT_PREVIEWED", entity: "ContactImport", entityId: importRecord.id, metadata: JSON.stringify({ rows: rows.length }) } });
    return NextResponse.json({ id: importRecord.id, rows: rows.map(({ phone: _phone, ...safe }) => safe) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar el archivo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
