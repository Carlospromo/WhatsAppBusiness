type OutboundConversation = {
  jid: string;
  type: "DIRECT" | "GROUP";
  contact?: { phone: string | null } | null;
};

/**
 * Baileys understands both phone-number JIDs and LIDs. For an existing
 * conversation, preserve the exact direct-chat identity received from
 * WhatsApp: changing an LID to a phone JID can make the recipient device
 * reject the encrypted message. A normalized phone is only a fallback for
 * legacy conversations without a valid WhatsApp JID.
 */
export function outboundDestinationJid(conversation: OutboundConversation) {
  if (conversation.type === "GROUP") return conversation.jid.endsWith("@g.us") ? conversation.jid : null;
  if (conversation.jid.endsWith("@lid") || conversation.jid.endsWith("@s.whatsapp.net")) return conversation.jid;
  const phone = conversation.contact?.phone;
  if (phone && /^\+[1-9]\d{6,14}$/.test(phone)) return `${phone.slice(1)}@s.whatsapp.net`;
  return null;
}
