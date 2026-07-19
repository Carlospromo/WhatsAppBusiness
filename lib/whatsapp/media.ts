import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { downloadContentFromMessage, downloadMediaMessage, type WAMessage, type WASocket } from "@whiskeysockets/baileys";
import { MediaAttachmentKind, MediaAttachmentStatus } from "@prisma/client";
import { decryptMediaSource } from "../media-encryption";
import { uploadMediaStream } from "../media-storage";
import { prisma } from "../prisma";

const MAX_ATTEMPTS = 3;

function positiveEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function mediaLimit(kind: MediaAttachmentKind) {
  if (kind === MediaAttachmentKind.IMAGE) return positiveEnvNumber("MEDIA_MAX_IMAGE_BYTES", 20 * 1024 * 1024);
  if (kind === MediaAttachmentKind.AUDIO) return positiveEnvNumber("MEDIA_MAX_AUDIO_BYTES", 50 * 1024 * 1024);
  return positiveEnvNumber("MEDIA_MAX_VIDEO_BYTES", 250 * 1024 * 1024);
}

function mediaType(kind: MediaAttachmentKind): "image" | "audio" | "video" {
  return kind === MediaAttachmentKind.IMAGE ? "image" : kind === MediaAttachmentKind.AUDIO ? "audio" : "video";
}

function limitedHashingStream(limit: number, onComplete: (size: number, sha256: string) => void) {
  let size = 0;
  const hash = createHash("sha256");
  return new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > limit) {
        const error = new Error("MEDIA_LIMIT_EXCEEDED");
        error.name = "MediaLimitError";
        callback(error);
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
    flush(callback) {
      onComplete(size, hash.digest("hex"));
      callback();
    },
  });
}

const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, child() { return silentLogger; } } as never;

async function markUnavailable(id: string) {
  await prisma.mediaAttachment.update({ where: { id }, data: { status: MediaAttachmentStatus.UNAVAILABLE, safeError: "Archivo no disponible.", sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null } });
}

async function retryOrFail(id: string, attempts: number, error: unknown) {
  const exceeded = error instanceof Error && error.message === "MEDIA_LIMIT_EXCEEDED";
  if (exceeded) {
    await prisma.mediaAttachment.update({ where: { id }, data: { status: MediaAttachmentStatus.REJECTED_LIMIT, safeError: "Archivo no almacenado por superar el límite permitido.", sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null } });
    return;
  }
  await prisma.mediaAttachment.update({ where: { id }, data: attempts >= MAX_ATTEMPTS
    ? { status: MediaAttachmentStatus.UNAVAILABLE, safeError: "Archivo no disponible.", sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null }
    : { status: MediaAttachmentStatus.RETRYING, safeError: "Preparando archivo…" } });
}

export async function processMediaAttachment(accountId: string, attachmentId: string, socket: WASocket, rawMessage?: WAMessage) {
  const claimed = await prisma.mediaAttachment.updateMany({ where: { id: attachmentId, accountId, status: { in: [MediaAttachmentStatus.PENDING, MediaAttachmentStatus.RETRYING] } }, data: { status: MediaAttachmentStatus.DOWNLOADING, lastAttemptAt: new Date(), attemptCount: { increment: 1 }, safeError: null } });
  if (!claimed.count) return;
  const attachment = await prisma.mediaAttachment.findFirst({ where: { id: attachmentId, accountId } });
  if (!attachment) return;
  const limit = mediaLimit(attachment.kind);
  if (attachment.sizeBytes && attachment.sizeBytes > limit) {
    await retryOrFail(attachment.id, attachment.attemptCount, new Error("MEDIA_LIMIT_EXCEEDED"));
    return;
  }
  const source = decryptMediaSource(attachment);
  if (!source) {
    await markUnavailable(attachment.id);
    return;
  }
  let sizeBytes = 0;
  let sha256 = "";
  try {
    const downloaded = rawMessage
      ? await downloadMediaMessage(rawMessage, "stream", {}, { logger: silentLogger, reuploadRequest: socket.updateMediaMessage })
      : await downloadContentFromMessage({ mediaKey: Buffer.from(source.mediaKey, "base64"), directPath: source.directPath, url: source.url }, mediaType(attachment.kind));
    const limited = limitedHashingStream(limit, (size, hash) => { sizeBytes = size; sha256 = hash; });
    downloaded.pipe(limited);
    await uploadMediaStream(attachment.objectKey, limited, attachment.mimeType);
    await prisma.mediaAttachment.update({ where: { id: attachment.id }, data: { status: MediaAttachmentStatus.STORED, sizeBytes, sha256, storedAt: new Date(), safeError: null, sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null } });
  } catch (error) {
    await retryOrFail(attachment.id, attachment.attemptCount, error);
  }
}

export async function recoverPendingMedia(accountId: string, socket: WASocket) {
  // A process can stop after claiming an attachment but before R2 confirms the
  // upload. Requeue only stale claims so a reconnect never races a live stream.
  await prisma.mediaAttachment.updateMany({ where: { accountId, status: MediaAttachmentStatus.DOWNLOADING, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() - 60_000) } }] }, data: { status: MediaAttachmentStatus.RETRYING, safeError: "Preparando archivo…" } });
  const attachments = await prisma.mediaAttachment.findMany({ where: { accountId, status: { in: [MediaAttachmentStatus.PENDING, MediaAttachmentStatus.RETRYING] } }, orderBy: { createdAt: "asc" }, take: 5, select: { id: true } });
  for (const attachment of attachments) await processMediaAttachment(accountId, attachment.id, socket);
}
