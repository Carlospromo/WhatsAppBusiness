import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { MediaSource } from "./whatsapp/normalize";

const ENVELOPE_VERSION = 1;

function encryptionKey() {
  const encoded = process.env.MEDIA_ENCRYPTION_KEY;
  if (!encoded) throw new Error("MEDIA_ENCRYPTION_KEY es obligatorio.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || Buffer.from(key).toString("base64") !== encoded) {
    throw new Error("MEDIA_ENCRYPTION_KEY debe ser una clave Base64 de 32 bytes.");
  }
  return key;
}

export type EncryptedMediaSource = {
  sourceEnvelopeCiphertext: string;
  sourceEnvelopeIv: string;
  sourceEnvelopeVersion: number;
};

export function encryptMediaSource(source: MediaSource): EncryptedMediaSource {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(source), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    sourceEnvelopeCiphertext: Buffer.concat([ciphertext, tag]).toString("base64"),
    sourceEnvelopeIv: iv.toString("base64"),
    sourceEnvelopeVersion: ENVELOPE_VERSION,
  };
}

export function decryptMediaSource(envelope: { sourceEnvelopeCiphertext: string | null; sourceEnvelopeIv: string | null; sourceEnvelopeVersion: number | null }): MediaSource | null {
  if (!envelope.sourceEnvelopeCiphertext || !envelope.sourceEnvelopeIv || envelope.sourceEnvelopeVersion !== ENVELOPE_VERSION) return null;
  try {
    const payload = Buffer.from(envelope.sourceEnvelopeCiphertext, "base64");
    if (payload.length < 17) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(envelope.sourceEnvelopeIv, "base64"));
    decipher.setAuthTag(payload.subarray(-16));
    const decoded = JSON.parse(Buffer.concat([decipher.update(payload.subarray(0, -16)), decipher.final()]).toString("utf8")) as MediaSource;
    if (!decoded || !["image", "audio", "video"].includes(decoded.mediaType) || typeof decoded.mediaKey !== "string" || (!decoded.directPath && !decoded.url)) return null;
    return decoded;
  } catch {
    return null;
  }
}
