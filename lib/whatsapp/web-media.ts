import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { MediaAttachmentKind, MediaAttachmentStatus } from "@prisma/client";
import { mediaObjectExists, uploadMediaStream } from "../media-storage";
import { operationalLog, safeErrorInfo, safeLogRef } from "../operational-log";
import { prisma } from "../prisma";

const MAX_ATTEMPTS = 3;

export type WebMediaStream = {
  stream: Readable;
  mimetype?: string | null;
  filesize?: number | null;
};

export type WebMediaMessage = {
  id?: { _serialized?: string; id?: string };
  downloadMediaStream?: () => Promise<WebMediaStream | undefined>;
  downloadMedia?: () => Promise<{ mimetype: string; data: string } | undefined>;
};
export type WebMediaClient = {
  getMessageById: (id: string) => Promise<WebMediaMessage | null>;
  getChatById?: (id: string) => Promise<{ fetchMessages: (options: { limit: number }) => Promise<WebMediaMessage[]> }>;
};

function positiveEnvNumber(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

/**
 * whatsapp-web.js exposes a documented Base64 download and a newer streaming
 * helper. The latter currently depends on an internal browser collection, so
 * small, bounded attachments use the documented download first. Streaming is
 * retained only as a recovery path when that standard method is unavailable.
 */
export function webMediaLimit(kind: MediaAttachmentKind) {
  const globalLimit = positiveEnvNumber("WA_WEB_MAX_MEDIA_BYTES", 25 * 1024 * 1024, 40 * 1024 * 1024);
  const kindLimit = kind === MediaAttachmentKind.IMAGE
    ? positiveEnvNumber("WA_WEB_MAX_IMAGE_BYTES", 10 * 1024 * 1024, 25 * 1024 * 1024)
    : kind === MediaAttachmentKind.AUDIO
      ? positiveEnvNumber("WA_WEB_MAX_AUDIO_BYTES", 20 * 1024 * 1024, 30 * 1024 * 1024)
      : positiveEnvNumber("WA_WEB_MAX_VIDEO_BYTES", 25 * 1024 * 1024, 40 * 1024 * 1024);
  return Math.min(globalLimit, kindLimit);
}

function decodedBase64Size(data: string) {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor(data.length * 3 / 4) - padding;
}

class MediaLimitAndHashTransform extends Transform {
  private readonly hash = createHash("sha256");
  private totalBytes = 0;

  constructor(private readonly limit: number) {
    super();
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.totalBytes += bytes.length;
    if (this.totalBytes > this.limit) {
      const error = new Error("MEDIA_LIMIT_EXCEEDED");
      error.name = "MediaLimitError";
      callback(error);
      return;
    }
    this.hash.update(bytes);
    callback(null, bytes);
  }

  result() {
    return { sizeBytes: this.totalBytes, sha256: this.hash.digest("hex") };
  }
}

function mediaErrorKind(error: unknown) {
  if (error instanceof Error && error.message === "MEDIA_LIMIT_EXCEEDED") return "LIMIT";
  if (error instanceof Error && error.message === "MEDIA_SOURCE_UNAVAILABLE") return "SOURCE_UNAVAILABLE";
  if (error instanceof Error && error.message === "MEDIA_STORAGE_VERIFY_FAILED") return "STORAGE_VERIFY";
  return "TRANSFER_ERROR";
}

export function mediaRetryStatus(attemptCount: number, error: unknown) {
  if (error instanceof Error && error.message === "MEDIA_LIMIT_EXCEEDED") return MediaAttachmentStatus.REJECTED_LIMIT;
  return attemptCount >= MAX_ATTEMPTS ? MediaAttachmentStatus.UNAVAILABLE : MediaAttachmentStatus.RETRYING;
}

async function retryOrFail(accountId: string, attachmentId: string, attemptCount: number, error: unknown) {
  const status = mediaRetryStatus(attemptCount, error);
  const attachment = safeLogRef(attachmentId);
  const errorKind = mediaErrorKind(error);
  await prisma.mediaAttachment.update({
    where: { id: attachmentId },
    data: status === MediaAttachmentStatus.REJECTED_LIMIT
      ? { status, safeError: "Archivo no almacenado por superar el límite permitido.", sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null }
      : status === MediaAttachmentStatus.UNAVAILABLE
        ? { status, safeError: "Archivo no disponible.", sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null }
        : { status, safeError: "Preparando archivo…" },
  });
  operationalLog(status === MediaAttachmentStatus.RETRYING ? "media.retry_scheduled" : "media.transfer_unavailable", {
    account: safeLogRef(accountId),
    attachment,
    attempts: attemptCount,
    errorKind,
    status,
    ...safeErrorInfo(error),
  }, status === MediaAttachmentStatus.UNAVAILABLE ? "error" : "info");
}

export async function sourceStream(message: WebMediaMessage, limit: number) {
  let base64Failure: unknown;
  if (message.downloadMedia) {
    try {
      const media = await message.downloadMedia();
      if (!media?.data) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
      if (decodedBase64Size(media.data) > limit) throw new Error("MEDIA_LIMIT_EXCEEDED");
      return { stream: Readable.from(Buffer.from(media.data, "base64")), transferMode: "BASE64" as const, base64Failure: null };
    } catch (error) {
      // A declared size above the limit is final. Other errors can still be
      // recoverable through the streaming helper.
      if (error instanceof Error && error.message === "MEDIA_LIMIT_EXCEEDED") throw error;
      base64Failure = error;
    }
  }
  if (!message.downloadMediaStream) {
    if (base64Failure) throw base64Failure;
    throw new Error("MEDIA_SOURCE_UNAVAILABLE");
  }
  const streamResult = await message.downloadMediaStream();
  if (!streamResult?.stream) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
  if (streamResult.filesize && streamResult.filesize > limit) throw new Error("MEDIA_LIMIT_EXCEEDED");
  return { stream: streamResult.stream, transferMode: "STREAM_FALLBACK" as const, base64Failure };
}

function messageExternalId(message: WebMediaMessage) {
  return message.id?._serialized ?? message.id?.id ?? null;
}

function supportsGetMessageById(externalId: string) {
  const parts = externalId.split("_");
  return parts.length === 3 || parts.length === 4;
}

type MediaSource = { message: WebMediaMessage; source: "EVENT" | "CACHE" | "CHAT" };

async function collectMediaSources(
  client: WebMediaClient,
  externalId: string,
  conversationChatIds: string[],
  initialMessage?: WebMediaMessage,
) {
  const sources: MediaSource[] = [];
  if (initialMessage) sources.push({ message: initialMessage, source: "EVENT" });

  // LID serialized identifiers are not always accepted by the public
  // getMessageById implementation. Only call it for the formats it supports.
  if (supportsGetMessageById(externalId)) {
    try {
      const cached = await client.getMessageById(externalId);
      if (cached && !sources.some((entry) => entry.message === cached)) sources.push({ message: cached, source: "CACHE" });
    } catch {
      // The chat fallback below is deliberately independent of this legacy
      // lookup and is the reliable recovery path for LID chats.
    }
  }

  if (client.getChatById) {
    for (const chatId of conversationChatIds) {
      try {
        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 40 });
        const matched = messages.find((message) => messageExternalId(message) === externalId);
        if (matched && !sources.some((entry) => entry.message === matched)) {
          sources.push({ message: matched, source: "CHAT" });
          break;
        }
      } catch {
        // Try the next verified chat identity. The transfer path records the
        // final redacted outcome without exposing chat identifiers.
      }
    }
  }

  return sources;
}

export async function processMediaAttachment(accountId: string, attachmentId: string, client: WebMediaClient, initialMessage?: WebMediaMessage) {
  const claimed = await prisma.mediaAttachment.updateMany({
    where: { id: attachmentId, accountId, status: { in: [MediaAttachmentStatus.PENDING, MediaAttachmentStatus.RETRYING] } },
    data: { status: MediaAttachmentStatus.DOWNLOADING, lastAttemptAt: new Date(), attemptCount: { increment: 1 }, safeError: null },
  });
  if (!claimed.count) return;
  const attachment = await prisma.mediaAttachment.findFirst({
    where: { id: attachmentId, accountId },
    include: {
      message: {
        select: {
          externalId: true,
          conversation: {
            select: {
              jid: true,
              contact: { select: { phone: true } },
              externalIdentities: {
                where: { bridgeType: "WWEBJS" },
                select: { externalChatId: true, normalizedPhone: true },
              },
            },
          },
        },
      },
    },
  });
  if (!attachment) return;

  const ref = safeLogRef(attachment.id);
  const limit = webMediaLimit(attachment.kind);
  operationalLog("media.transfer_claimed", { account: safeLogRef(accountId), attachment: ref, kind: attachment.kind, attempts: attachment.attemptCount });
  if (attachment.sizeBytes && attachment.sizeBytes > limit) {
    await retryOrFail(accountId, attachment.id, attachment.attemptCount, new Error("MEDIA_LIMIT_EXCEEDED"));
    return;
  }

  try {
    const conversation = attachment.message.conversation;
    const verifiedPhones = [
      conversation.contact?.phone,
      ...conversation.externalIdentities.map((identity) => identity.normalizedPhone),
    ].filter((phone): phone is string => Boolean(phone && /^\+[1-9]\d{6,14}$/.test(phone)));
    const chatIds = [...new Set([
      conversation.jid,
      ...conversation.externalIdentities.map((identity) => identity.externalChatId),
      ...verifiedPhones.map((phone) => `${phone.slice(1)}@c.us`),
    ])];
    const sources = await collectMediaSources(client, attachment.message.externalId, chatIds, initialMessage);
    if (!sources.length) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
    let downloaded: Awaited<ReturnType<typeof sourceStream>> | undefined;
    let lastError: unknown;
    for (const candidate of sources) {
      try {
        operationalLog("media.download_started", { account: safeLogRef(accountId), attachment: ref, kind: attachment.kind, source: candidate.source });
        downloaded = await sourceStream(candidate.message, limit);
        break;
      } catch (error) {
        lastError = error;
        operationalLog("media.source_attempt_failed", { account: safeLogRef(accountId), attachment: ref, kind: attachment.kind, source: candidate.source, ...safeErrorInfo(error) }, "info");
      }
    }
    if (!downloaded) throw lastError ?? new Error("MEDIA_SOURCE_UNAVAILABLE");
    if (downloaded.base64Failure) {
      operationalLog("media.base64_fallback", {
        account: safeLogRef(accountId),
        attachment: ref,
        kind: attachment.kind,
        ...safeErrorInfo(downloaded.base64Failure),
      });
    }
    const meter = new MediaLimitAndHashTransform(limit);
    const uploadStream = downloaded.stream.pipe(meter);
    operationalLog("media.upload_started", { account: safeLogRef(accountId), attachment: ref, kind: attachment.kind, transferMode: downloaded.transferMode });
    await uploadMediaStream(attachment.objectKey, uploadStream, attachment.mimeType);
    const result = meter.result();
    if (!result.sizeBytes || !(await mediaObjectExists(attachment.objectKey))) throw new Error("MEDIA_STORAGE_VERIFY_FAILED");
    await prisma.mediaAttachment.update({
      where: { id: attachment.id },
      data: { status: MediaAttachmentStatus.STORED, sizeBytes: result.sizeBytes, sha256: result.sha256, storedAt: new Date(), safeError: null, sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null },
    });
    operationalLog("media.upload_completed", { account: safeLogRef(accountId), attachment: ref, kind: attachment.kind, sizeBytes: result.sizeBytes, transferMode: downloaded.transferMode, status: "STORED" });
  } catch (error) {
    await retryOrFail(accountId, attachment.id, attachment.attemptCount, error);
  }
}

export async function recoverPendingMedia(
  accountId: string,
  client: WebMediaClient,
  cachedEvent?: (attachmentId: string) => WebMediaMessage | undefined,
) {
  await prisma.mediaAttachment.updateMany({
    where: { accountId, status: MediaAttachmentStatus.DOWNLOADING, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() - 60_000) } }] },
    data: { status: MediaAttachmentStatus.RETRYING, safeError: "Preparando archivo…" },
  });
  const attachments = await prisma.mediaAttachment.findMany({ where: { accountId, status: { in: [MediaAttachmentStatus.PENDING, MediaAttachmentStatus.RETRYING] } }, orderBy: { createdAt: "asc" }, take: 3, select: { id: true } });
  for (const attachment of attachments) await processMediaAttachment(accountId, attachment.id, client, cachedEvent?.(attachment.id));
}
