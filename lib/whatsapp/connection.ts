import { WhatsAppConnectionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function updateConnection(data: {
  status: WhatsAppConnectionStatus;
  qrCode?: string | null;
  qrExpiresAt?: Date | null;
  accountJid?: string | null;
  maskedPhone?: string | null;
  lastError?: string | null;
}) {
  return prisma.whatsAppConnection.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });
}

export async function auditConnection(action: string) {
  await prisma.auditLog.create({ data: { action, entity: "WhatsAppConnection", entityId: "default" } });
}
