import type { WAMessageContent } from "@whiskeysockets/baileys";
import { MessageDirection } from "@prisma/client";
import { prisma } from "../prisma";

/**
 * Supplies Baileys with the minimum original content needed when a recipient
 * asks for an encrypted-message retry. Outbound media is not supported yet.
 */
export async function getOutboundMessageForRetry(accountId: string, externalId: string | null | undefined): Promise<WAMessageContent | undefined> {
  if (!externalId) return undefined;
  const message = await prisma.message.findUnique({
    where: { accountId_externalId: { accountId, externalId } },
    select: { direction: true, messageType: true, body: true },
  });
  if (!message || message.direction !== MessageDirection.OUTBOUND || message.messageType !== "text" || !message.body) return undefined;
  return { conversation: message.body };
}
