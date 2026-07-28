import { MediaAttachmentKind } from "@prisma/client";

export type WebMediaDescriptor = {
  kind: MediaAttachmentKind;
  mimeType: string;
  declaredSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type NormalizedWebMessage = {
  externalId: string;
  conversationJid: string;
  senderJid: string;
  phoneJid?: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string;
  messageType: "text" | "image" | "audio" | "video";
  media?: WebMediaDescriptor;
  sentAt: Date;
  conversationType: "DIRECT" | "GROUP";
};

export type WebMessageLike = {
  id?: { _serialized?: string; $1?: string; id?: string };
  from?: string;
  to?: string;
  fromMe?: boolean;
  body?: string;
  type?: string;
  timestamp?: number;
  hasMedia?: boolean;
  isEphemeral?: boolean;
  isStatus?: boolean;
  isGif?: boolean;
  rawData?: Record<string, unknown>;
};

const allowedMimeTypes: Record<MediaAttachmentKind, Set<string>> = {
  IMAGE: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
  AUDIO: new Set(["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/webm", "audio/wav", "audio/x-wav"]),
  VIDEO: new Set(["video/mp4", "video/webm", "video/3gpp", "video/quicktime"]),
};

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2_147_483_647 ? Math.floor(value) : undefined;
}

function safeMime(value: unknown, kind: MediaAttachmentKind) {
  if (typeof value !== "string") return null;
  const mime = value.split(";", 1)[0].trim().toLowerCase();
  return allowedMimeTypes[kind].has(mime) ? mime : null;
}

function rawObject(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function temporaryOrUnsupported(message: WebMessageLike) {
  const raw = rawObject(message.rawData);
  const type = String(message.type ?? raw.type ?? "").toLowerCase();
  // whatsapp-web.js exposes isEphemeral publicly. View-once is intentionally
  // deny-by-default because its raw representation may change with Web builds.
  return Boolean(message.isEphemeral || message.isStatus || raw.isViewOnce || raw.isEphemeral || type.includes("view_once") || type.includes("ephemeral") || type === "sticker" || type === "document" || type === "ptt" && !message.hasMedia);
}

function mediaFor(message: WebMessageLike): WebMediaDescriptor | null {
  if (!message.hasMedia || message.isGif) return null;
  const raw = rawObject(message.rawData);
  const type = String(message.type ?? raw.type ?? "").toLowerCase();
  const kind = type === "image" ? MediaAttachmentKind.IMAGE : type === "audio" || type === "ptt" ? MediaAttachmentKind.AUDIO : type === "video" ? MediaAttachmentKind.VIDEO : null;
  if (!kind) return null;
  const mimeType = safeMime(raw.mimetype ?? raw.mimeType, kind);
  if (!mimeType) return null;
  return {
    kind,
    mimeType,
    declaredSize: numberValue(raw.size ?? raw.fileSize),
    width: numberValue(raw.width),
    height: numberValue(raw.height),
    durationSeconds: numberValue(raw.duration ?? raw.seconds),
  };
}

export function previewForMessage(message: Pick<NormalizedWebMessage, "body" | "media">) {
  const label = message.media?.kind === MediaAttachmentKind.IMAGE ? "📷 Imagen"
    : message.media?.kind === MediaAttachmentKind.AUDIO ? "🎙️ Audio"
      : message.media?.kind === MediaAttachmentKind.VIDEO ? "🎥 Vídeo"
        : null;
  return label ? [label, message.body].filter(Boolean).join(" · ").slice(0, 240) : message.body.slice(0, 240);
}

export function phoneFromWebChatId(chatId: string | null | undefined) {
  if (!chatId?.endsWith("@c.us")) return null;
  const digits = chatId.slice(0, -5).replace(/\D/g, "");
  return /^\d{7,15}$/.test(digits) ? `+${digits}` : null;
}

export function maskPhone(chatId: string | null | undefined) {
  const phone = phoneFromWebChatId(chatId);
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits ? `${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : null;
}

export function normalizeWebMessage(message: WebMessageLike): NormalizedWebMessage | null {
  const externalId = message.id?._serialized ?? message.id?.$1 ?? message.id?.id;
  const fromMe = Boolean(message.fromMe);
  const conversationJid = fromMe ? message.to : message.from;
  if (!externalId || !conversationJid || temporaryOrUnsupported(message)) return null;
  // WhatsApp Web normally exposes direct chats as @c.us, but linked-device
  // rollouts can surface a LID identity first. It is still a direct chat,
  // although no phone number is inferred until a verified mapping arrives.
  const conversationType = conversationJid.endsWith("@g.us") ? "GROUP" : (conversationJid.endsWith("@c.us") || conversationJid.endsWith("@lid")) ? "DIRECT" : null;
  if (!conversationType) return null;
  const media = mediaFor(message);
  const body = String(message.body ?? "").trim();
  if (!body && !media) return null;
  return {
    externalId,
    conversationJid,
    senderJid: conversationType === "GROUP" ? (fromMe ? "self" : String(message.from ?? conversationJid)) : conversationJid,
    phoneJid: conversationType === "DIRECT" && conversationJid.endsWith("@c.us") ? conversationJid : undefined,
    direction: fromMe ? "OUTBOUND" : "INBOUND",
    body,
    messageType: media?.kind === MediaAttachmentKind.IMAGE ? "image" : media?.kind === MediaAttachmentKind.AUDIO ? "audio" : media?.kind === MediaAttachmentKind.VIDEO ? "video" : "text",
    media: fromMe ? undefined : media ?? undefined,
    sentAt: new Date((numberValue(message.timestamp) ?? Math.floor(Date.now() / 1_000)) * 1_000),
    conversationType,
  };
}
