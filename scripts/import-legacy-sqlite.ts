import "dotenv/config";
import Database from "better-sqlite3";
import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma";

const source = process.env.LEGACY_SQLITE_DATABASE_URL;
if (!source?.startsWith("file:")) throw new Error("Define LEGACY_SQLITE_DATABASE_URL con una ruta file: explícita.");
const path = source.slice(5);
const legacy = new Database(path, { readonly: true, fileMustExist: true });
const rows = (table: string) => legacy.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
const value = (row: Record<string, unknown>, key: string) => row[key] == null ? null : String(row[key]);
const date = (row: Record<string, unknown>, key: string) => row[key] ? new Date(String(row[key])) : undefined;

async function main() {
  const previous = await prisma.auditLog.findFirst({ where: { action: "LEGACY_SQLITE_IMPORTED", entity: "SystemMigration" }, select: { id: true } });
  if (previous) return;
  const admin = await prisma.user.findFirst({ where: { role: Role.ADMIN }, select: { id: true } });
  const account = await prisma.whatsAppAccount.upsert({ where: { slug: "cuenta-principal" }, create: { name: "Cuenta principal", slug: "cuenta-principal", createdById: admin?.id }, update: {} });
  for (const row of rows("User")) await prisma.user.upsert({ where: { id: String(row.id) }, create: { id: String(row.id), email: String(row.email), name: String(row.name), passwordHash: String(row.passwordHash), role: String(row.role) as Role, isActive: Boolean(row.isActive), createdAt: date(row, "createdAt"), updatedAt: date(row, "updatedAt") }, update: {} });
  const users = await prisma.user.findMany({ select: { id: true } });
  await prisma.whatsAppAccountMembership.createMany({ data: users.map((user) => ({ accountId: account.id, userId: user.id })), skipDuplicates: true });
  for (const row of rows("Contact")) await prisma.contact.upsert({ where: { accountId_jid: { accountId: account.id, jid: String(row.jid) } }, create: { id: String(row.id), accountId: account.id, jid: String(row.jid), phone: value(row, "phone"), displayName: value(row, "displayName"), pushName: value(row, "pushName"), syncedAt: date(row, "syncedAt"), createdAt: date(row, "createdAt"), updatedAt: date(row, "updatedAt") }, update: {} });
  for (const row of rows("Conversation")) await prisma.conversation.upsert({ where: { accountId_jid: { accountId: account.id, jid: String(row.jid) } }, create: { id: String(row.id), accountId: account.id, jid: String(row.jid), type: String(row.type) as "DIRECT" | "GROUP", contactId: value(row, "contactId"), lastMessageAt: date(row, "lastMessageAt"), lastMessagePreview: value(row, "lastMessagePreview"), unreadCount: Number(row.unreadCount || 0), assignedToId: value(row, "assignedToId"), assignedAt: date(row, "assignedAt"), createdAt: date(row, "createdAt"), updatedAt: date(row, "updatedAt") }, update: {} });
  for (const row of rows("Message")) await prisma.message.upsert({ where: { accountId_externalId: { accountId: account.id, externalId: String(row.externalId) } }, create: { id: String(row.id), accountId: account.id, externalId: String(row.externalId), conversationId: String(row.conversationId), direction: String(row.direction) as "INBOUND" | "OUTBOUND", senderJid: String(row.senderJid), body: value(row, "body"), messageType: String(row.messageType), sentAt: date(row, "sentAt")!, importedAt: date(row, "importedAt"), isRead: Boolean(row.isRead) }, update: {} });
  await prisma.session.deleteMany();
  await prisma.auditLog.create({ data: { accountId: account.id, action: "LEGACY_SQLITE_IMPORTED", entity: "SystemMigration", entityId: account.id } });
}
main().finally(async () => { legacy.close(); await prisma.$disconnect(); });
