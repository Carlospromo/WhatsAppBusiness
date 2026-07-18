import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { parse as parseCsv } from "csv-parse/sync";
import { getCountries, parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
import { AddressBookContactOrigin, AddressBookContactStatus, ContactImportItemAction } from "@prisma/client";
import { prisma } from "./prisma";

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 25_000;

export type ImportRow = {
  rowNumber: number;
  name: string;
  lastName?: string | null;
  email?: string | null;
  company?: string | null;
  tags?: string | null;
  phone: string;
  normalizedPhone: string | null;
  action: ContactImportItemAction;
  safeError?: string | null;
};

const allowedHeaders = new Set(["nombre", "telefono", "apellidos", "email", "empresa", "etiquetas"]);

function text(value: unknown, limit = 160) {
  const result = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return result.slice(0, limit) || null;
}

function normalizeHeader(value: unknown) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function validCountry(value: unknown) {
  return typeof value === "string" && getCountries().includes(value as CountryCode) ? value : null;
}

export function normalizePhone(value: unknown, defaultCountry = "ES") {
  const raw = text(value, 64);
  const country = validCountry(defaultCountry) as CountryCode | null;
  if (!raw || !country) return null;
  const parsed = parsePhoneNumberFromString(raw, country);
  return parsed?.isValid() ? parsed.number : null;
}

export function phoneFromJid(jid: string | null | undefined) {
  if (!jid?.endsWith("@s.whatsapp.net")) return null;
  const digits = jid.split("@")[0].replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
}

function valueFromCell(value: ExcelJS.CellValue) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value instanceof Date) return "";
  // Do not evaluate formulas. Formula cells are deliberately considered empty.
  return "";
}

async function readRows(fileName: string, content: Buffer): Promise<Record<string, unknown>[]> {
  if (content.byteLength > MAX_IMPORT_BYTES) throw new Error("El archivo supera el tamaño permitido.");
  const extension = fileName.toLowerCase().split(".").pop();
  if (extension === "csv") {
    const source = content.toString("utf8");
    if (source.includes("\uFFFD")) throw new Error("El CSV debe estar codificado en UTF-8.");
    return parseCsv(source, { columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: false });
  }
  if (extension === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content.buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("El Excel no contiene una hoja.");
    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, columnNumber) => { headers[columnNumber - 1] = normalizeHeader(valueFromCell(cell.value)); });
    const rows: Record<string, unknown>[] = [];
    for (let rowNumber = 2; rowNumber <= Math.min(sheet.rowCount, MAX_IMPORT_ROWS + 1); rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      rows.push(Object.fromEntries(headers.map((header, index) => [header, valueFromCell(row.getCell(index + 1).value)])));
    }
    return rows;
  }
  throw new Error("Solo se admiten archivos XLSX o CSV.");
}

export async function previewImport(fileName: string, content: Buffer, defaultCountry: string): Promise<{ fileHash: string; rows: ImportRow[] }> {
  const rawRows = await readRows(fileName, content);
  if (rawRows.length > MAX_IMPORT_ROWS) throw new Error("El archivo supera el número de filas permitido.");
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rawRows.entries()) {
    const record = Object.fromEntries(Object.entries(raw).map(([key, value]) => [normalizeHeader(key), value]));
    if (Object.keys(record).some((key) => !allowedHeaders.has(key))) throw new Error("La plantilla contiene columnas no permitidas.");
    const name = text(record.nombre, 120) ?? "";
    const phone = text(record.telefono, 64) ?? "";
    const normalizedPhone = normalizePhone(phone, defaultCountry);
    let action: ContactImportItemAction = ContactImportItemAction.CREATE;
    let safeError: string | null = null;
    if (!name || !phone || !normalizedPhone) { action = ContactImportItemAction.ERROR; safeError = "Nombre o teléfono inválido."; }
    else if (seen.has(normalizedPhone)) { action = ContactImportItemAction.SKIP; safeError = "Teléfono duplicado en el archivo."; }
    if (normalizedPhone) seen.add(normalizedPhone);
    rows.push({ rowNumber: index + 2, name, phone, normalizedPhone, action, safeError, lastName: text(record.apellidos), email: text(record.email), company: text(record.empresa), tags: text(record.etiquetas, 300) });
  }
  return { fileHash: createHash("sha256").update(content).digest("hex"), rows };
}

export async function reconcileWhatsAppContact(accountId: string, input: { jid: string; displayName?: string | null; pushName?: string | null; origin: AddressBookContactOrigin }) {
  const phone = phoneFromJid(input.jid);
  const technical = await prisma.contact.upsert({
    where: { accountId_jid: { accountId, jid: input.jid } },
    create: { accountId, jid: input.jid, phone, displayName: input.displayName ?? null, pushName: input.pushName ?? null },
    update: { phone, displayName: input.displayName ?? undefined, pushName: input.pushName ?? undefined, syncedAt: new Date() },
  });
  if (!phone) return technical;
  const known = await prisma.addressBookPhone.findUnique({ where: { accountId_normalizedPhone: { accountId, normalizedPhone: phone } }, include: { addressBookContact: true } });
  if (known) return prisma.contact.update({ where: { id: technical.id }, data: { addressBookContactId: known.addressBookContactId } });
  const addressBookContact = await prisma.addressBookContact.create({
    data: {
      accountId,
      displayName: input.displayName?.trim() || input.pushName?.trim() || (input.origin === AddressBookContactOrigin.EXTERNAL ? "Contacto externo" : "Contacto de WhatsApp"),
      origin: input.origin,
      status: input.origin === AddressBookContactOrigin.EXTERNAL ? AddressBookContactStatus.EXTERNAL : AddressBookContactStatus.VERIFIED,
      phones: { create: { accountId, normalizedPhone: phone } },
    },
  });
  return prisma.contact.update({ where: { id: technical.id }, data: { addressBookContactId: addressBookContact.id } });
}

export async function reconcileExistingContacts(accountId: string) {
  const contacts = await prisma.contact.findMany({ where: { accountId }, select: { jid: true, displayName: true, pushName: true } });
  let linked = 0; let created = 0;
  for (const contact of contacts) {
    const phone = phoneFromJid(contact.jid);
    if (!phone) continue;
    const known = await prisma.addressBookPhone.findUnique({ where: { accountId_normalizedPhone: { accountId, normalizedPhone: phone } } });
    await reconcileWhatsAppContact(accountId, { ...contact, origin: AddressBookContactOrigin.WHATSAPP_SYNC });
    if (known) linked += 1; else created += 1;
  }
  return { linked, created };
}

export async function applyContactImport(importId: string) {
  const imported = await prisma.contactImport.findUnique({ where: { id: importId }, include: { items: { orderBy: { rowNumber: "asc" } } } });
  if (!imported || imported.status === "APPLIED") return null;
  let createdRows = 0; let updatedRows = 0; let skippedRows = 0; let errorRows = 0;
  for (const item of imported.items) {
    if (item.action === ContactImportItemAction.ERROR || item.action === ContactImportItemAction.SKIP || !item.normalizedPhone || !item.proposedName) {
      if (item.action === ContactImportItemAction.ERROR) errorRows += 1; else skippedRows += 1;
      continue;
    }
    const data = { displayName: item.proposedName, lastName: item.proposedLastName, email: item.proposedEmail, company: item.proposedCompany, tags: item.proposedTags, origin: AddressBookContactOrigin.IMPORTED, status: AddressBookContactStatus.VERIFIED, importId: imported.id };
    const existing = await prisma.addressBookPhone.findUnique({ where: { accountId_normalizedPhone: { accountId: imported.accountId, normalizedPhone: item.normalizedPhone } } });
    if (existing) {
      await prisma.addressBookContact.update({ where: { id: existing.addressBookContactId }, data });
      await prisma.contact.updateMany({ where: { accountId: imported.accountId, phone: item.normalizedPhone.slice(1) }, data: { addressBookContactId: existing.addressBookContactId } });
      updatedRows += 1;
    } else {
      const addressBookContact = await prisma.addressBookContact.create({ data: { accountId: imported.accountId, createdById: imported.createdById, ...data, phones: { create: { accountId: imported.accountId, normalizedPhone: item.normalizedPhone } } } });
      await prisma.contact.updateMany({ where: { accountId: imported.accountId, phone: item.normalizedPhone.slice(1) }, data: { addressBookContactId: addressBookContact.id } });
      createdRows += 1;
    }
  }
  return prisma.contactImport.update({ where: { id: imported.id }, data: { status: "APPLIED", appliedAt: new Date(), createdRows, updatedRows, skippedRows, errorRows } });
}
