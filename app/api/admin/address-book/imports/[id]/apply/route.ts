import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessAccount } from "@/lib/account";
import { applyContactImport } from "@/lib/address-book";
import { prisma } from "@/lib/prisma";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  const { id } = await params; const importRecord = await prisma.contactImport.findUnique({ where: { id }, select: { accountId: true, status: true } });
  if (!importRecord) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (!await canAccessAccount(user, importRecord.accountId)) return NextResponse.json({ error: "Prohibido" }, { status: 403 });
  if (importRecord.status === "APPLIED") return NextResponse.json({ error: "La importación ya fue aplicada" }, { status: 409 });
  const result = await applyContactImport(id); if (!result) return NextResponse.json({ error: "No se pudo aplicar la importación" }, { status: 400 });
  await prisma.auditLog.create({ data: { userId: user.id, accountId: importRecord.accountId, action: "ADDRESS_BOOK_IMPORT_APPLIED", entity: "ContactImport", entityId: id, metadata: JSON.stringify({ created: result.createdRows, updated: result.updatedRows }) } });
  return NextResponse.json({ id: result.id, status: result.status, createdRows: result.createdRows, updatedRows: result.updatedRows, skippedRows: result.skippedRows, errorRows: result.errorRows });
}
