import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { MediaAttachmentKind, MediaAttachmentStatus } from "@prisma/client";
import { uploadMediaStream } from "../media-storage";
import { prisma } from "../prisma";

const MAX_ATTEMPTS = 3;

export type WebMediaMessage = {
  downloadMedia: () => Promise<{ mimetype: string; data: string } | undefined>;
};
export type WebMediaClient = { getMessageById: (id: string) => Promise<WebMediaMessage | null> };

function positiveEnvNumber(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

/** whatsapp-web.js returns Base64, so these are deliberately lower than the
 * previous streaming bridge limits. */
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

async function markUnavailable(id: string) {
  await prisma.mediaAttachment.update({ where: { id }, data: { status: MediaAttachmentStatus.UNAVAILABLE, safeError: "Archivo no disponible.", sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null } });
}

async function retryOrFail(id: string, attempts: number, error: unknown) {
  const exceeded = error instanceof Error && error.message === "MEDIA_LIMIT_EXCEEDED";
  await prisma.mediaAttachment.update({ where: { id }, data: exceeded
    ? { status: MediaAttachmentStatus.REJECTED_LIMIT, safeError: "Archivo no almacenado por superar el límite permitido.", sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null }
    : attempts >= MAX_ATTEMPTS
      ? { status: MediaAttachmentStatus.UNAVAILABLE, safeError: "Archivo no disponible.", sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null }
      : { status: MediaAttachmentStatus.RETRYING, safeError: "Preparando archivo…" },
  });
}

export async function processMediaAttachment(accountId: string, attachmentId: string, client: WebMediaClient, initialMessage?: WebMediaMessage) {
  const claimed = await prisma.mediaAttachment.updateMany({ where: { id: attachmentId, accountId, status: { in: [MediaAttachmentStatus.PENDING, MediaAttachmentStatus.RETRYING] } }, data: { status: MediaAttachmentStatus.DOWNLOADING, lastAttemptAt: new Date(), attemptCount: { increment: 1 }, safeError: null } });
  if (!claimed.count) return;
  const attachment = await prisma.mediaAttachment.findFirst({ where: { id: attachmentId, accountId }, include: { message: { select: { externalId: true } } } });
  if (!attachment) return;
  const limit = webMediaLimit(attachment.kind);
  if (attachment.sizeBytes && attachment.sizeBytes > limit) {
    await retryOrFail(attachment.id, attachment.attemptCount + 1, new Error("MEDIA_LIMIT_EXCEEDED"));
    return;
  }
  try {
    const source = initialMessage ?? await client.getMessageById(attachment.message.externalId);
    if (!source) return await markUnavailable(attachment.id);
    const media = await source.downloadMedia();
    if (!media?.data || decodedBase64Size(media.data) > limit) throw new Error("MEDIA_LIMIT_EXCEEDED");
    const bytes = Buffer.from(media.data, "base64");
    if (!bytes.length || bytes.length > limit) throw new Error("MEDIA_LIMIT_EXCEEDED");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await uploadMediaStream(attachment.objectKey, Readable.from(bytes), attachment.mimeType);
    await prisma.mediaAttachment.update({ where: { id: attachment.id }, data: { status: MediaAttachmentStatus.STORED, sizeBytes: bytes.length, sha256, storedAt: new Date(), safeError: null, sourceEnvelopeCiphertext: null, sourceEnvelopeIv: null, sourceEnvelopeVersion: null } });
  } catch (error) {
    await retryOrFail(attachment.id, attachment.attemptCount + 1, error);
  }
}

export async function recoverPendingMedia(accountId: string, client: WebMediaClient) {
  await prisma.mediaAttachment.updateMany({ where: { accountId, status: MediaAttachmentStatus.DOWNLOADING, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() - 60_000) } }] }, data: { status: MediaAttachmentStatus.RETRYING, safeError: "Preparando archivo…" } });
  const attachments = await prisma.mediaAttachment.findMany({ where: { accountId, status: { in: [MediaAttachmentStatus.PENDING, MediaAttachmentStatus.RETRYING] } }, orderBy: { createdAt: "asc" }, take: 3, select: { id: true } });
  for (const attachment of attachments) await processMediaAttachment(accountId, attachment.id, client);
}
