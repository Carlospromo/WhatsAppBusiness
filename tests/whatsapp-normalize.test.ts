import { describe, expect, it } from "vitest";
import { maskPhone, normalizeWhatsAppMessage } from "../lib/whatsapp/normalize";

describe("WhatsApp message normalization", () => {
  it("normalizes a text message without exposing media", () => {
    const normalized = normalizeWhatsAppMessage({
      key: { id: "message-1", remoteJid: "34600000000@s.whatsapp.net", fromMe: false },
      messageTimestamp: 1_700_000_000,
      message: { conversation: " Hola " },
    });
    expect(normalized).toMatchObject({ externalId: "message-1", direction: "INBOUND", body: "Hola", conversationType: "DIRECT" });
  });

  it("ignores messages without text and masks phone numbers", () => {
    expect(normalizeWhatsAppMessage({ key: { id: "media", remoteJid: "x@g.us" }, message: {} })).toBeNull();
    expect(maskPhone("34600000000@s.whatsapp.net")).toBe("•••••••0000");
  });
});
