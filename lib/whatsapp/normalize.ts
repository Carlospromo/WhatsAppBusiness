export type NormalizedMessage = {
  externalId: string;
  conversationJid: string;
  senderJid: string;
  phoneJid?: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  messageType: "text";
  sentAt: Date;
  conversationType: "DIRECT" | "GROUP";
};

type BaileysMessage = {
  key: { id?: string | null; remoteJid?: string | null; remoteJidAlt?: string | null; participant?: string | null; participantAlt?: string | null; senderPn?: string | null; participantPn?: string | null; fromMe?: boolean | null };
  messageTimestamp?: number | LongLike | null;
  message?: { conversation?: string | null; extendedTextMessage?: { text?: string | null } | null } | null;
};
type LongLike = { toNumber?: () => number };

export function normalizeWhatsAppMessage(message: BaileysMessage): NormalizedMessage | null {
  const externalId = message.key.id;
  const conversationJid = message.key.remoteJid;
  const body = message.message?.conversation ?? message.message?.extendedTextMessage?.text;
  if (!externalId || !conversationJid || !body?.trim()) return null;

  const timestamp = typeof message.messageTimestamp === "number"
    ? message.messageTimestamp
    : message.messageTimestamp?.toNumber?.() ?? Math.floor(Date.now() / 1000);
  const fromMe = Boolean(message.key.fromMe);
  const conversationType = conversationJid.endsWith("@g.us") ? "GROUP" : "DIRECT";
  const isPhoneJid = (value: string | null | undefined): value is string => Boolean(value?.endsWith("@s.whatsapp.net"));
  const phoneJid = conversationType === "DIRECT"
    ? (fromMe
      ? [message.key.remoteJid, message.key.remoteJidAlt, message.key.participantPn].find(isPhoneJid)
      : [message.key.senderPn, message.key.participantPn, message.key.remoteJidAlt, message.key.remoteJid].find(isPhoneJid))
    : undefined;
  return {
    externalId,
    conversationJid,
    senderJid: conversationType === "GROUP"
      ? message.key.participantPn ?? message.key.participantAlt ?? message.key.participant ?? conversationJid
      : phoneJid ?? conversationJid,
    phoneJid,
    direction: fromMe ? "OUTBOUND" : "INBOUND",
    body: body.trim(),
    messageType: "text",
    sentAt: new Date(timestamp * 1000),
    conversationType,
  };
}

export function maskPhone(jid: string | null | undefined) {
  const digits = jid?.split("@")[0].split(":")[0].replace(/\D/g, "") ?? "";
  if (!digits) return null;
  return `${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
