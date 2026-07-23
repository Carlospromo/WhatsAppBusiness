import { WhatsAppBridgeType } from "@prisma/client";

type OutboundConversation = {
  jid: string;
  type: "DIRECT" | "GROUP";
  contact?: { phone: string | null } | null;
  externalIdentities?: Array<{ bridgeType: WhatsAppBridgeType; externalChatId: string }>;
};

export type OutboundDestinationKind = "direct" | "group" | "unknown";

export type OutboundDestination = {
  jid: string | null;
  kind: OutboundDestinationKind;
  phoneFallbackPresent: boolean;
};

/**
 * The browser bridge uses @c.us for direct chats. Historical identifiers are
 * only used as a source for a verified phone already stored in the domain.
 */
export function outboundDestinationJid(conversation: OutboundConversation) {
  const webIdentity = conversation.externalIdentities?.find((identity) => identity.bridgeType === WhatsAppBridgeType.WWEBJS)?.externalChatId;
  if (webIdentity) return webIdentity;
  if (conversation.type === "GROUP") return conversation.jid.endsWith("@g.us") ? conversation.jid : null;
  const phone = conversation.contact?.phone;
  if (phone && /^\+[1-9]\d{6,14}$/.test(phone)) return `${phone.slice(1)}@c.us`;
  if (conversation.jid.endsWith("@c.us")) return conversation.jid;
  return null;
}

/**
 * Keep diagnostics useful without exposing the technical destination.
 */
export function resolveOutboundDestination(conversation: OutboundConversation): OutboundDestination {
  const jid = outboundDestinationJid(conversation);
  const kind: OutboundDestinationKind = !jid ? "unknown"
    : jid.endsWith("@g.us") ? "group" : "direct";
  return {
    jid,
    kind,
    phoneFallbackPresent: Boolean(conversation.contact?.phone && /^\+[1-9]\d{6,14}$/.test(conversation.contact.phone)),
  };
}
