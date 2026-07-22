import { MessageDirection, OutboundMessageStatus, WhatsAppConnectionStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { outboundSafetyLimits, type OutboundSafetyLimits } from "../whatsapp/outbound-safety";

export type AuditSafetyAlert = {
  level: "warning" | "info";
  title: string;
  detail: string;
};

export type AuditSafetyDashboard = {
  generatedAt: string;
  limits: OutboundSafetyLimits;
  accounts: { active: number; connected: number; restricted: number };
  outbound: { pending: number; sending: number; failedLast24Hours: number; canceledLast24Hours: number; stuckSending: number; acknowledgedLast24Hours: number; rejectedLast24Hours: number };
  inbound: { importedLastHour: number; importedLast24Hours: number; lastImportedAt: string | null };
  readReceipts: { failedLast24Hours: number };
  restrictionEventsLast7Days: number;
  alerts: AuditSafetyAlert[];
};

export function safetyAlerts(input: Pick<AuditSafetyDashboard, "accounts" | "outbound" | "readReceipts">): AuditSafetyAlert[] {
  const alerts: AuditSafetyAlert[] = [];
  if (input.accounts.restricted > 0) {
    alerts.push({ level: "warning", title: "Envíos restringidos", detail: `${input.accounts.restricted} cuenta(s) tienen la cola de salida pausada por una restricción de WhatsApp.` });
  }
  if (input.outbound.stuckSending > 0) {
    alerts.push({ level: "warning", title: "Envíos atascados", detail: `${input.outbound.stuckSending} solicitud(es) siguen en proceso desde hace más de 15 minutos.` });
  }
  if (input.outbound.rejectedLast24Hours > 0) {
    alerts.push({ level: "warning", title: "Entregas rechazadas", detail: `${input.outbound.rejectedLast24Hours} envío(s) fueron rechazados por WhatsApp durante las últimas 24 horas.` });
  }
  if (input.outbound.canceledLast24Hours > 0) {
    alerts.push({ level: "info", title: "Envíos cancelados", detail: `${input.outbound.canceledLast24Hours} envío(s) se cancelaron de forma segura durante las últimas 24 horas, sin reintento automático.` });
  }
  if (input.readReceipts.failedLast24Hours > 0) {
    alerts.push({ level: "info", title: "Lecturas pendientes", detail: `${input.readReceipts.failedLast24Hours} recibo(s) de lectura no se pudieron sincronizar en las últimas 24 horas.` });
  }
  if (!alerts.length) {
    alerts.push({ level: "info", title: "Sin alertas operativas", detail: "No hay restricciones ni fallos de entrega recientes registrados." });
  }
  return alerts;
}

export async function getAuditSafetyDashboard(): Promise<AuditSafetyDashboard> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1_000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1_000);
  const staleSendingBefore = new Date(now.getTime() - 15 * 60 * 1_000);

  const [accounts, outboundByStatus, failedLast24Hours, canceledLast24Hours, stuckSending, inboundLastHour, inboundLast24Hours, lastInbound, acknowledgedLast24Hours, rejectedLast24Hours, readReceiptFailures, restrictionEventsLast7Days] = await Promise.all([
    prisma.whatsAppAccount.findMany({
      where: { isActive: true },
      select: { connection: { select: { status: true, outboundPausedAt: true, outboundPauseEndsAt: true } } },
    }),
    prisma.outboundMessageRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.outboundMessageRequest.count({ where: { status: OutboundMessageStatus.FAILED, updatedAt: { gte: oneDayAgo } } }),
    prisma.outboundMessageRequest.count({ where: { status: OutboundMessageStatus.CANCELED, updatedAt: { gte: oneDayAgo } } }),
    prisma.outboundMessageRequest.count({ where: { status: OutboundMessageStatus.SENDING, updatedAt: { lt: staleSendingBefore } } }),
    prisma.message.count({ where: { direction: MessageDirection.INBOUND, importedAt: { gte: oneHourAgo } } }),
    prisma.message.count({ where: { direction: MessageDirection.INBOUND, importedAt: { gte: oneDayAgo } } }),
    prisma.message.findFirst({ where: { direction: MessageDirection.INBOUND }, orderBy: { importedAt: "desc" }, select: { importedAt: true } }),
    prisma.auditLog.count({ where: { action: "OUTBOUND_SERVER_ACKNOWLEDGED", createdAt: { gte: oneDayAgo } } }),
    prisma.auditLog.count({ where: { action: { in: ["OUTBOUND_DELIVERY_REJECTED", "OUTBOUND_DELIVERY_CANCELED"] }, createdAt: { gte: oneDayAgo } } }),
    prisma.auditLog.count({ where: { action: "WHATSAPP_READ_RECEIPT_FAILED", createdAt: { gte: oneDayAgo } } }),
    prisma.auditLog.count({ where: { action: "OUTBOUND_RESTRICTION_PAUSED", createdAt: { gte: sevenDaysAgo } } }),
  ]);

  const statusCount = new Map(outboundByStatus.map((item) => [item.status, item._count._all]));
  const restricted = accounts.filter(({ connection }) => Boolean(connection?.outboundPausedAt && (!connection.outboundPauseEndsAt || connection.outboundPauseEndsAt > now))).length;
  const dashboard: Omit<AuditSafetyDashboard, "alerts"> = {
    generatedAt: now.toISOString(),
    limits: outboundSafetyLimits(),
    accounts: { active: accounts.length, connected: accounts.filter(({ connection }) => connection?.status === WhatsAppConnectionStatus.CONNECTED).length, restricted },
    outbound: {
      pending: statusCount.get(OutboundMessageStatus.PENDING) ?? 0,
      sending: statusCount.get(OutboundMessageStatus.SENDING) ?? 0,
      failedLast24Hours,
      canceledLast24Hours,
      stuckSending,
      acknowledgedLast24Hours,
      rejectedLast24Hours,
    },
    inbound: { importedLastHour: inboundLastHour, importedLast24Hours: inboundLast24Hours, lastImportedAt: lastInbound?.importedAt.toISOString() ?? null },
    readReceipts: { failedLast24Hours: readReceiptFailures },
    restrictionEventsLast7Days,
  };
  return { ...dashboard, alerts: safetyAlerts(dashboard) };
}
