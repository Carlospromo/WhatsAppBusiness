import { WhatsAppConnectionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function updateConnection(accountId: string, data: {
  status: WhatsAppConnectionStatus;
  qrCode?: string | null;
  qrExpiresAt?: Date | null;
  accountJid?: string | null;
  maskedPhone?: string | null;
  lastError?: string | null;
}) {
  return prisma.whatsAppConnection.upsert({
    where: { accountId },
    create: { accountId, ...data },
    update: data,
  });
}

export async function auditConnection(accountId: string, action: string) {
  await prisma.auditLog.create({ data: { accountId, action, entity: "WhatsAppConnection", entityId: accountId } });
}
