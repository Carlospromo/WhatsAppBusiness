import { describe, expect, it } from "vitest";
import { MediaAttachmentKind } from "@prisma/client";
import { webMediaLimit } from "../lib/whatsapp/web-media";

describe("browser media limits", () => {
  it("keeps video limits conservative because downloads use Base64", () => {
    expect(webMediaLimit(MediaAttachmentKind.VIDEO)).toBeLessThanOrEqual(40 * 1024 * 1024);
  });
});
