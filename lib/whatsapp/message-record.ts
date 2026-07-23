import type { NormalizedWebMessage } from "./normalize-web-message";

/** Maps a normalized bridge event to fields that belong to the Message model. */
export function messageRecordData(accountId: string, conversationId: string, message: NormalizedWebMessage) {
  return {
    accountId,
    conversationId,
    externalId: message.externalId,
    direction: message.direction,
    senderJid: message.senderJid,
    receiptParticipant: null,
    body: message.body,
    messageType: message.messageType,
    sentAt: message.sentAt,
    isRead: message.direction === "OUTBOUND",
  };
}
