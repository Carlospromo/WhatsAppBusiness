import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { MediaAttachmentKind } from "@prisma/client";
import { mediaRetryStatus, sourceStream, webMediaLimit } from "../lib/whatsapp/web-media";
import { MediaAttachmentStatus } from "@prisma/client";

describe("browser media limits", () => {
  it("keeps video limits conservative for browser-side downloads", () => {
    expect(webMediaLimit(MediaAttachmentKind.VIDEO)).toBeLessThanOrEqual(40 * 1024 * 1024);
  });

  it("does not exhaust a transient media download before the third attempt", () => {
    expect(mediaRetryStatus(1, new Error("MEDIA_SOURCE_UNAVAILABLE"))).toBe(MediaAttachmentStatus.RETRYING);
    expect(mediaRetryStatus(2, new Error("MEDIA_SOURCE_UNAVAILABLE"))).toBe(MediaAttachmentStatus.RETRYING);
    expect(mediaRetryStatus(3, new Error("MEDIA_SOURCE_UNAVAILABLE"))).toBe(MediaAttachmentStatus.UNAVAILABLE);
  });

  it("rejects over-limit files without retrying them", () => {
    expect(mediaRetryStatus(1, new Error("MEDIA_LIMIT_EXCEEDED"))).toBe(MediaAttachmentStatus.REJECTED_LIMIT);
  });

  it("uses the documented Base64 download when it is available", async () => {
    const result = await sourceStream({
      downloadMediaStream: async () => { throw new Error("stream bridge should not be called"); },
      downloadMedia: async () => ({ mimetype: "image/jpeg", data: Buffer.from("media").toString("base64") }),
    }, 1024);
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    expect(result.transferMode).toBe("BASE64");
    expect(result.base64Failure).toBeNull();
    expect(Buffer.concat(chunks).toString()).toBe("media");
  });

  it("falls back to streaming when the Base64 download is unavailable", async () => {
    const result = await sourceStream({
      downloadMediaStream: async () => ({ stream: Readable.from(Buffer.from("media")), filesize: 5 }),
      downloadMedia: async () => { throw new Error("Base64 bridge unavailable"); },
    }, 1024);
    expect(result.transferMode).toBe("STREAM_FALLBACK");
    expect(result.base64Failure).toBeInstanceOf(Error);
  });
});
