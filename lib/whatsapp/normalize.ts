import { getContentType, normalizeMessageContent } from "@whiskeysockets/baileys";
import { MediaAttachmentKind } from "@prisma/client";

export type MediaSource = {
  mediaKey: string;
  directPath?: string;
  url?: string;
  mediaType: "image" | "audio" | "video";
};

export type NormalizedMedia = {
  kind: MediaAttachmentKind;
  mimeType: string;
  declaredSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  source?: MediaSource;
};

export type NormalizedMessage = {
  externalId: string;
  conversationJid: string;
  senderJid: string;
  phoneJid?: string;
  /** Original group participant key required by Baileys read receipts. */
  receiptParticipant?: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  messageType: "text" | "image" | "audio" | "video";
  media?: NormalizedMedia;
  sentAt: Date;
  conversationType: "DIRECT" | "GROUP";
};

type LongLike = { toNumber?: () => number };
type MediaPayload = {
  caption?: string | null;
  mimetype?: string | null;
  fileLength?: number | LongLike | null;
  width?: number | null;
  height?: number | null;
  seconds?: number | null;
  mediaKey?: Uint8Array | string | null;
  directPath?: string | null;
  url?: string | null;
  gifPlayback?: boolean | null;
};
type MessageContent = {
  conversation?: string | null;
  extendedTextMessage?: { text?: string | null } | null;
  imageMessage?: MediaPayload | null;
  audioMessage?: MediaPayload | null;
  videoMessage?: MediaPayload | null;
  viewOnceMessage?: { message?: MessageContent | null } | null;
  viewOnceMessageV2?: { message?: MessageContent | null } | null;
  viewOnceMessageV2Extension?: { message?: MessageContent | null } | null;
  ephemeralMessage?: { message?: MessageContent | null } | null;
  documentWithCaptionMessage?: { message?: MessageContent | null } | null;
};
type BaileysMessage = {
  key: { id?: string | null; remoteJid?: string | null; remoteJidAlt?: string | null; participant?: string | null; participantAlt?: string | null; senderPn?: string | null; participantPn?: string | null; fromMe?: boolean | null };
  messageTimestamp?: number | LongLike | null;
  message?: MessageContent | null;
};

const allowedMimeTypes: Record<MediaAttachmentKind, Set<string>> = {
  IMAGE: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  AUDIO: new Set(["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/webm", "audio/wav", "audio/x-wav"]),
  VIDEO: new Set(["video/mp4", "video/webm", "video/3gpp", "video/quicktime"]),
};

function numberValue(value: number | LongLike | null | undefined) {
  const number = typeof value === "number" ? value : value?.toNumber?.();
  return typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 2_147_483_647 ? Math.floor(number) : undefined;
}

function safeMime(value: string | null | undefined, kind: MediaAttachmentKind) {
  const mime = value?.split(";", 1)[0].trim().toLowerCase();
  return mime && allowedMimeTypes[kind].has(mime) ? mime : null;
}

function hasTemporaryPrivacyWrapper(content: MessageContent | null | undefined, depth = 0): boolean {
  if (!content || depth > 5) return false;
  const viewOnce = content.viewOnceMessage ?? content.viewOnceMessageV2 ?? content.viewOnceMessageV2Extension;
  if (viewOnce) return true;
  if (content.ephemeralMessage) return true;
  return hasTemporaryPrivacyWrapper(content.documentWithCaptionMessage?.message, depth + 1);
}

function sourceFor(payload: MediaPayload, mediaType: MediaSource["mediaType"]): MediaSource | undefined {
  const key = payload.mediaKey;
  const mediaKey = typeof key === "string" ? key : key ? Buffer.from(key).toString("base64") : null;
  if (!mediaKey || (!payload.directPath && !payload.url)) return undefined;
  return { mediaKey, directPath: payload.directPath ?? undefined, url: payload.url ?? undefined, mediaType };
}

function mediaFor(content: MessageContent): NormalizedMedia | null {
  const contentType = getContentType(content as never);
  if (contentType === "imageMessage" && content.imageMessage) {
    const mimeType = safeMime(content.imageMessage.mimetype, MediaAttachmentKind.IMAGE);
    return mimeType ? { kind: MediaAttachmentKind.IMAGE, mimeType, declaredSize: numberValue(content.imageMessage.fileLength), width: numberValue(content.imageMessage.width), height: numberValue(content.imageMessage.height), source: sourceFor(content.imageMessage, "image") } : null;
  }
  if (contentType === "audioMessage" && content.audioMessage) {
    const mimeType = safeMime(content.audioMessage.mimetype, MediaAttachmentKind.AUDIO);
    return mimeType ? { kind: MediaAttachmentKind.AUDIO, mimeType, declaredSize: numberValue(content.audioMessage.fileLength), durationSeconds: numberValue(content.audioMessage.seconds), source: sourceFor(content.audioMessage, "audio") } : null;
  }
  if (contentType === "videoMessage" && content.videoMessage && !content.videoMessage.gifPlayback) {
    const mimeType = safeMime(content.videoMessage.mimetype, MediaAttachmentKind.VIDEO);
    return mimeType ? { kind: MediaAttachmentKind.VIDEO, mimeType, declaredSize: numberValue(content.videoMessage.fileLength), width: numberValue(content.videoMessage.width), height: numberValue(content.videoMessage.height), durationSeconds: numberValue(content.videoMessage.seconds), source: sourceFor(content.videoMessage, "video") } : null;
  }
  return null;
}

export function previewForMessage(message: Pick<NormalizedMessage, "body" | "media">) {
  const label = message.media?.kind === MediaAttachmentKind.IMAGE ? "📷 Imagen"
    : message.media?.kind === MediaAttachmentKind.AUDIO ? "🎙️ Audio"
      : message.media?.kind === MediaAttachmentKind.VIDEO ? "🎥 Vídeo"
        : null;
  return label ? [label, message.body].filter(Boolean).join(" · ").slice(0, 240) : message.body.slice(0, 240);
}

export function normalizeWhatsAppMessage(message: BaileysMessage): NormalizedMessage | null {
  const externalId = message.key.id;
  const conversationJid = message.key.remoteJid;
  if (!externalId || !conversationJid || !message.message || hasTemporaryPrivacyWrapper(message.message)) return null;

  const content = normalizeMessageContent(message.message as never) as MessageContent | undefined;
  if (!content) return null;
  const media = mediaFor(content);
  const body = (content.conversation ?? content.extendedTextMessage?.text ?? content.imageMessage?.caption ?? content.videoMessage?.caption ?? "").trim();
  if (!body && !media) return null;

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
  const incomingMedia = fromMe ? undefined : media ?? undefined;
  if (!body && !incomingMedia) return null;
  return {
    externalId,
    conversationJid,
    senderJid: conversationType === "GROUP"
      ? message.key.participantPn ?? message.key.participantAlt ?? message.key.participant ?? conversationJid
      : phoneJid ?? conversationJid,
    phoneJid,
    receiptParticipant: conversationType === "GROUP" ? message.key.participant ?? undefined : undefined,
    direction: fromMe ? "OUTBOUND" : "INBOUND",
    body,
    messageType: incomingMedia?.kind === MediaAttachmentKind.IMAGE ? "image"
      : incomingMedia?.kind === MediaAttachmentKind.AUDIO ? "audio"
        : incomingMedia?.kind === MediaAttachmentKind.VIDEO ? "video"
          : "text",
    media: incomingMedia,
    sentAt: new Date(timestamp * 1000),
    conversationType,
  };
}

export function maskPhone(jid: string | null | undefined) {
  const digits = jid?.split("@")[0].split(":")[0].replace(/\D/g, "") ?? "";
  if (!digits) return null;
  return `${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
