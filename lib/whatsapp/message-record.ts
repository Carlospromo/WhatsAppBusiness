import type { NormalizedMessage } from "./normalize";

/** Maps a Baileys event to fields that actually belong to the Message model. */
export function messageRecordData(accountId: string, conversationId: string, message: NormalizedMessage) {
  return {
    accountId,
    conversationId,
    externalId: message.externalId,
    direction: message.direction,
    senderJid: message.senderJid,
    receiptParticipant: message.receiptParticipant,
    body: message.body,
    messageType: message.messageType,
    sentAt: message.sentAt,
    isRead: message.direction === "OUTBOUND",
  };
}
