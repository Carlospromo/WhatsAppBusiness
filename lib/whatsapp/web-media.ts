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
  downloadMediaStream?: () => Promise<WebMediaStream | undefined>;
  downloadMedia?: () => Promise<{ mimetype: string; data: string } | undefined>;
};
export type WebMediaClient = { getMessageById: (id: string) => Promise<WebMediaMessage | null> };

function positiveEnvNumber(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

/** whatsapp-web.js can expose a stream in current supported builds. The
 * fallback stays deliberately bounded for compatible builds that only expose
 * Base64. */
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

async function sourceStream(message: WebMediaMessage, limit: number) {
  if (message.downloadMediaStream) {
    const streamResult = await message.downloadMediaStream();
    if (!streamResult?.stream) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
    if (streamResult.filesize && streamResult.filesize > limit) throw new Error("MEDIA_LIMIT_EXCEEDED");
    return { stream: streamResult.stream, transferMode: "STREAM" as const };
  }
  if (!message.downloadMedia) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
  const media = await message.downloadMedia();
  if (!media?.data || decodedBase64Size(media.data) > limit) throw new Error("MEDIA_LIMIT_EXCEEDED");
  return { stream: Readable.from(Buffer.from(media.data, "base64")), transferMode: "BASE64_FALLBACK" as const };
}

export async function processMediaAttachment(accountId: string, attachmentId: string, client: WebMediaClient, initialMessage?: WebMediaMessage) {
  const claimed = await prisma.mediaAttachment.updateMany({
    where: { id: attachmentId, accountId, status: { in: [MediaAttachmentStatus.PENDING, MediaAttachmentStatus.RETRYING] } },
    data: { status: MediaAttachmentStatus.DOWNLOADING, lastAttemptAt: new Date(), attemptCount: { increment: 1 }, safeError: null },
  });
  if (!claimed.count) return;
  const attachment = await prisma.mediaAttachment.findFirst({ where: { id: attachmentId, accountId }, include: { message: { select: { externalId: true } } } });
  if (!attachment) return;

  const ref = safeLogRef(attachment.id);
  const limit = webMediaLimit(attachment.kind);
  operationalLog("media.transfer_claimed", { account: safeLogRef(accountId), attachment: ref, kind: attachment.kind, attempts: attachment.attemptCount });
  if (attachment.sizeBytes && attachment.sizeBytes > limit) {
    await retryOrFail(accountId, attachment.id, attachment.attemptCount, new Error("MEDIA_LIMIT_EXCEEDED"));
    return;
  }

  try {
    const source = initialMessage ?? await client.getMessageById(attachment.message.externalId);
    if (!source) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
    operationalLog("media.download_started", { account: safeLogRef(accountId), attachment: ref, kind: attachment.kind });
    const downloaded = await sourceStream(source, limit);
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

export async function recoverPendingMedia(accountId: string, client: WebMediaClient) {
  await prisma.mediaAttachment.updateMany({
    where: { accountId, status: MediaAttachmentStatus.DOWNLOADING, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() - 60_000) } }] },
    data: { status: MediaAttachmentStatus.RETRYING, safeError: "Preparando archivo…" },
  });
  const attachments = await prisma.mediaAttachment.findMany({ where: { accountId, status: { in: [MediaAttachmentStatus.PENDING, MediaAttachmentStatus.RETRYING] } }, orderBy: { createdAt: "asc" }, take: 3, select: { id: true } });
  for (const attachment of attachments) await processMediaAttachment(accountId, attachment.id, client);
}
