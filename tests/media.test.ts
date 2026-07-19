import { afterEach, describe, expect, it } from "vitest";
import { MediaAttachmentKind } from "@prisma/client";
import { decryptMediaSource, encryptMediaSource } from "../lib/media-encryption";
import { mediaLimit } from "../lib/whatsapp/media";
import { normalizeWhatsAppMessage, previewForMessage } from "../lib/whatsapp/normalize";

const previousKey = process.env.MEDIA_ENCRYPTION_KEY;
afterEach(() => { if (previousKey === undefined) delete process.env.MEDIA_ENCRYPTION_KEY; else process.env.MEDIA_ENCRYPTION_KEY = previousKey; delete process.env.MEDIA_MAX_IMAGE_BYTES; });

describe("incoming WhatsApp media", () => {
  it("normalizes an image without text and creates a safe preview", () => {
    const message = normalizeWhatsAppMessage({
      key: { id: "image-1", remoteJid: "34600000000@s.whatsapp.net", fromMe: false },
      messageTimestamp: 1_700_000_000,
      message: { imageMessage: { mimetype: "image/jpeg", fileLength: 123, width: 100, height: 50, mediaKey: new Uint8Array([1, 2, 3]), directPath: "/image" } },
    });
    expect(message).toMatchObject({ body: "", messageType: "image", media: { kind: MediaAttachmentKind.IMAGE, mimeType: "image/jpeg", declaredSize: 123 } });
    expect(previewForMessage(message!)).toBe("📷 Imagen");
  });

  it("keeps the caption with a video but excludes gifs", () => {
    const video = normalizeWhatsAppMessage({
      key: { id: "video-1", remoteJid: "34600000000@s.whatsapp.net", fromMe: false },
      message: { videoMessage: { mimetype: "video/mp4", caption: "Vacaciones", mediaKey: new Uint8Array([1]), directPath: "/video" } },
    });
    expect(video).toMatchObject({ body: "Vacaciones", messageType: "video" });
    expect(previewForMessage(video!)).toBe("🎥 Vídeo · Vacaciones");
    expect(normalizeWhatsAppMessage({ key: { id: "gif", remoteJid: "34600000000@s.whatsapp.net", fromMe: false }, message: { videoMessage: { mimetype: "video/mp4", gifPlayback: true, mediaKey: new Uint8Array([1]), directPath: "/video" } } })).toBeNull();
  });

  it("does not retain view-once or ephemeral media", () => {
    const image = { imageMessage: { mimetype: "image/jpeg", mediaKey: new Uint8Array([1]), directPath: "/image" } };
    expect(normalizeWhatsAppMessage({ key: { id: "once", remoteJid: "34600000000@s.whatsapp.net", fromMe: false }, message: { viewOnceMessage: { message: image } } })).toBeNull();
    expect(normalizeWhatsAppMessage({ key: { id: "ephemeral", remoteJid: "34600000000@s.whatsapp.net", fromMe: false }, message: { ephemeralMessage: { message: image } } })).toBeNull();
  });

  it("encrypts temporary media descriptors and clears their plaintext representation", () => {
    process.env.MEDIA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptMediaSource({ mediaKey: "secret-media-key", directPath: "/private", mediaType: "audio" });
    expect(encrypted.sourceEnvelopeCiphertext).not.toContain("secret-media-key");
    expect(decryptMediaSource(encrypted)).toEqual({ mediaKey: "secret-media-key", directPath: "/private", mediaType: "audio" });
  });

  it("uses configured hard media limits", () => {
    process.env.MEDIA_MAX_IMAGE_BYTES = "100";
    expect(mediaLimit(MediaAttachmentKind.IMAGE)).toBe(100);
  });
});
