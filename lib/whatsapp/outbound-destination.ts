type OutboundConversation = {
  jid: string;
  type: "DIRECT" | "GROUP";
  contact?: { phone: string | null } | null;
};

export type OutboundDestinationKind = "pn" | "lid" | "group" | "unknown";

export type OutboundDestination = {
  jid: string | null;
  kind: OutboundDestinationKind;
  phoneFallbackPresent: boolean;
};

/**
 * A direct LID is a device-scoped identity, not a telephone identity. When
 * Baileys has supplied the corresponding phone JID in an incoming event, it
 * is stored on the technical Contact and is the correct destination for a
 * new direct message. Do not derive a number from an LID: if that verified
 * phone identity is unavailable, retain the LID as the only known identity.
 */
export function outboundDestinationJid(conversation: OutboundConversation) {
  if (conversation.type === "GROUP") return conversation.jid.endsWith("@g.us") ? conversation.jid : null;
  const phone = conversation.contact?.phone;
  // Contact.phone is populated only from a phone JID received from WhatsApp
  // (senderPn/remoteJidAlt), never by transforming an LID locally.
  if (phone && /^\+[1-9]\d{6,14}$/.test(phone)) return `${phone.slice(1)}@s.whatsapp.net`;
  if (conversation.jid.endsWith("@lid") || conversation.jid.endsWith("@s.whatsapp.net")) return conversation.jid;
  return null;
}

/**
 * Keep diagnostics useful without exposing the technical destination. The
 * destination kind reports the identity actually handed to Baileys.
 */
export function resolveOutboundDestination(conversation: OutboundConversation): OutboundDestination {
  const jid = outboundDestinationJid(conversation);
  const kind: OutboundDestinationKind = !jid ? "unknown"
    : jid.endsWith("@g.us") ? "group"
      : jid.endsWith("@lid") ? "lid"
        : "pn";
  return {
    jid,
    kind,
    phoneFallbackPresent: Boolean(conversation.contact?.phone && /^\+[1-9]\d{6,14}$/.test(conversation.contact.phone)),
  };
}
