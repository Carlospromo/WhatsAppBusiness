import { describe, expect, it } from "vitest";
import { MediaAttachmentKind } from "@prisma/client";
import { mediaRetryStatus, webMediaLimit } from "../lib/whatsapp/web-media";
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
});
