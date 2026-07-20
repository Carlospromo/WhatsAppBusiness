type OutboundConversation = {
  jid: string;
  type: "DIRECT" | "GROUP";
  contact?: { phone: string | null } | null;
};

/**
 * Baileys can receive a direct chat under a LID, but a phone-number JID is
 * the stable destination for a new outbound message. Never use a LID as a
 * fallback: it is an internal identity rather than a deliverable address.
 */
export function outboundDestinationJid(conversation: OutboundConversation) {
  if (conversation.type === "GROUP") return conversation.jid.endsWith("@g.us") ? conversation.jid : null;
  const phone = conversation.contact?.phone;
  if (phone && /^\+[1-9]\d{6,14}$/.test(phone)) return `${phone.slice(1)}@s.whatsapp.net`;
  return conversation.jid.endsWith("@s.whatsapp.net") ? conversation.jid : null;
}
