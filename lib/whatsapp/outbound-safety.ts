import { OutboundMessageStatus } from "@prisma/client";
import { prisma } from "../prisma";

type Environment = Record<string, string | undefined>;

export type OutboundSafetyLimits = {
  maxPending: number;
  maxPerMinute: number;
  minIntervalMs: number;
  maxNewChatsPerDay: number;
};

export type OutboundSafetyDecision =
  | { allowed: true }
  | { allowed: false; reason: "RESTRICTED" | "PENDING_LIMIT" | "NEW_CHAT_LIMIT" | "RATE_LIMIT" | "MIN_INTERVAL" };

type OutboundSafetyReason = Extract<OutboundSafetyDecision, { allowed: false }>["reason"];

function positiveInteger(environment: Environment, name: string, fallback: number, minimum: number, maximum: number) {
  const value = environment[name];
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} debe ser un número entero.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} debe estar entre ${minimum} y ${maximum}.`);
  }
  return parsed;
}

export function outboundSafetyLimits(environment: Environment = process.env): OutboundSafetyLimits {
  return {
    maxPending: positiveInteger(environment, "WA_OUTBOUND_MAX_PENDING", 20, 1, 500),
    maxPerMinute: positiveInteger(environment, "WA_OUTBOUND_MAX_PER_MINUTE", 6, 1, 60),
    minIntervalMs: positiveInteger(environment, "WA_OUTBOUND_MIN_INTERVAL_SECONDS", 5, 1, 300) * 1_000,
    maxNewChatsPerDay: positiveInteger(environment, "WA_OUTBOUND_MAX_NEW_CHATS_PER_DAY", 10, 1, 100),
  };
}

const limits = outboundSafetyLimits();

function startOfCurrentDay() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

export async function pauseOutboundForRestriction(accountId: string, endsAt?: Date) {
  const paused = await prisma.whatsAppConnection.updateMany({
    where: { accountId, outboundPausedAt: null },
    data: {
      outboundPausedAt: new Date(),
      outboundPauseReason: "WHATSAPP_RESTRICTION",
      outboundPauseEndsAt: endsAt ?? null,
    },
  });
  if (paused.count) {
    await prisma.auditLog.create({
      data: { accountId, action: "OUTBOUND_RESTRICTION_PAUSED", entity: "WhatsAppConnection", entityId: accountId },
    });
  }
}

export async function clearOutboundRestriction(accountId: string) {
  const cleared = await prisma.whatsAppConnection.updateMany({
    where: { accountId, outboundPausedAt: { not: null } },
    data: { outboundPausedAt: null, outboundPauseReason: null, outboundPauseEndsAt: null },
  });
  if (cleared.count) {
    await prisma.auditLog.create({
      data: { accountId, action: "OUTBOUND_RESTRICTION_CLEARED", entity: "WhatsAppConnection", entityId: accountId },
    });
  }
}

async function accountIsRestricted(accountId: string) {
  const connection = await prisma.whatsAppConnection.findUnique({
    where: { accountId },
    select: { outboundPausedAt: true, outboundPauseEndsAt: true },
  });
  if (!connection?.outboundPausedAt) return false;
  if (connection.outboundPauseEndsAt && connection.outboundPauseEndsAt <= new Date()) {
    await clearOutboundRestriction(accountId);
    return false;
  }
  return true;
}

export async function canQueueOutbound(accountId: string, startsNewDirectConversation: boolean): Promise<OutboundSafetyDecision> {
  if (await accountIsRestricted(accountId)) return { allowed: false, reason: "RESTRICTED" };

  const [pendingCount, newChatsToday] = await Promise.all([
    prisma.outboundMessageRequest.count({
      where: { accountId, status: { in: [OutboundMessageStatus.PENDING, OutboundMessageStatus.SENDING] } },
    }),
    startsNewDirectConversation
      ? prisma.conversation.count({ where: { accountId, type: "DIRECT", createdAt: { gte: startOfCurrentDay() } } })
      : Promise.resolve(0),
  ]);

  if (pendingCount >= limits.maxPending) return { allowed: false, reason: "PENDING_LIMIT" };
  if (startsNewDirectConversation && newChatsToday >= limits.maxNewChatsPerDay) return { allowed: false, reason: "NEW_CHAT_LIMIT" };
  return { allowed: true };
}

export async function canDispatchOutbound(accountId: string): Promise<OutboundSafetyDecision> {
  if (await accountIsRestricted(accountId)) return { allowed: false, reason: "RESTRICTED" };
  const since = new Date(Date.now() - 60_000);
  const [recentCount, lastAttempt] = await Promise.all([
    prisma.outboundMessageRequest.count({
      where: {
        accountId,
        status: { in: [OutboundMessageStatus.SENDING, OutboundMessageStatus.SENT] },
        updatedAt: { gte: since },
      },
    }),
    prisma.outboundMessageRequest.findFirst({
      where: { accountId, status: { in: [OutboundMessageStatus.SENDING, OutboundMessageStatus.SENT] } },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
  ]);
  if (recentCount >= limits.maxPerMinute) return { allowed: false, reason: "RATE_LIMIT" };
  if (lastAttempt && Date.now() - lastAttempt.updatedAt.getTime() < limits.minIntervalMs) return { allowed: false, reason: "MIN_INTERVAL" };
  return { allowed: true };
}

export function safeOutboundSafetyMessage(reason: OutboundSafetyReason) {
  if (reason === "RESTRICTED") return "WhatsApp ha restringido temporalmente los envíos de esta cuenta.";
  if (reason === "PENDING_LIMIT") return "La cola de envíos ha alcanzado el límite preventivo de esta cuenta.";
  if (reason === "NEW_CHAT_LIMIT") return "La cuenta ha alcanzado el límite preventivo diario de conversaciones nuevas.";
  return "El envío está temporalmente limitado para proteger la cuenta.";
}
