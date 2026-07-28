import { describe, expect, it } from "vitest";
import { normalizeWebMessage, phoneFromWebChatId } from "../lib/whatsapp/normalize-web-message";
import { phoneFromConversationJid } from "../lib/conversation-identity";

describe("whatsapp-web.js message normalization", () => {
  it("normalizes direct text messages", () => {
    expect(normalizeWebMessage({ id: { _serialized: "message-1" }, from: "34600000000@c.us", body: "Hola", type: "chat", timestamp: 1, fromMe: false })).toMatchObject({ conversationJid: "34600000000@c.us", direction: "INBOUND", messageType: "text" });
    expect(phoneFromWebChatId("34600000000@c.us")).toBe("+34600000000");
  });

  it("rejects ephemeral and unsupported media", () => {
    expect(normalizeWebMessage({ id: { _serialized: "message-2" }, from: "34600000000@c.us", type: "image", hasMedia: true, isEphemeral: true })).toBeNull();
    expect(normalizeWebMessage({ id: { _serialized: "message-3" }, from: "34600000000@c.us", type: "document", hasMedia: true })).toBeNull();
  });

  it("keeps a caption and classifies supported incoming media", () => {
    const image = normalizeWebMessage({
      id: { _serialized: "image-1" }, from: "34600000000@c.us", body: "Una imagen", type: "image", hasMedia: true,
      rawData: { mimetype: "image/jpeg", size: 123, width: 10, height: 20 },
    });
    expect(image).toMatchObject({ body: "Una imagen", messageType: "image", media: { kind: "IMAGE", mimeType: "image/jpeg", declaredSize: 123 } });

    const audio = normalizeWebMessage({ id: { _serialized: "audio-1" }, from: "34600000000@c.us", type: "audio", hasMedia: true, rawData: { mimetype: "audio/ogg" } });
    const video = normalizeWebMessage({ id: { _serialized: "video-1" }, from: "34600000000@c.us", type: "video", hasMedia: true, rawData: { mimetype: "video/mp4" } });
    expect(audio?.messageType).toBe("audio");
    expect(video?.messageType).toBe("video");
  });

  it("keeps supported media created from the linked mobile app", () => {
    const image = normalizeWebMessage({
      id: { _serialized: "outbound-image-1" }, to: "34600000000@c.us", fromMe: true, type: "image", hasMedia: true,
      rawData: { mimetype: "image/jpeg", size: 321, width: 20, height: 10 },
    });
    expect(image).toMatchObject({
      direction: "OUTBOUND",
      conversationJid: "34600000000@c.us",
      messageType: "image",
      media: { kind: "IMAGE", mimeType: "image/jpeg", declaredSize: 321 },
    });
  });

  it("normalizes direct and group chat identities without accepting unknown ids", () => {
    expect(normalizeWebMessage({ id: { _serialized: "group-1" }, from: "123@g.us", body: "Hola", type: "chat" })?.conversationType).toBe("GROUP");
    expect(normalizeWebMessage({ id: { _serialized: "unknown-1" }, from: "123@unknown", body: "Hola", type: "chat" })).toBeNull();
  });

  it("accepts a direct LID identity without inventing a phone number", () => {
    const result = normalizeWebMessage({ id: { _serialized: "lid-1" }, from: "123456789@lid", body: "Hola", type: "chat", timestamp: 100 });
    expect(result).toMatchObject({ conversationJid: "123456789@lid", conversationType: "DIRECT", direction: "INBOUND", phoneJid: undefined });
  });

  it("uses the current WhatsApp Web $1 serialized key when _serialized is absent", () => {
    const result = normalizeWebMessage({ id: { $1: "false_123456789@lid_A1B2" }, from: "123456789@lid", type: "image", hasMedia: true, rawData: { mimetype: "image/jpeg" } });
    expect(result).toMatchObject({ externalId: "false_123456789@lid_A1B2", messageType: "image" });
  });

  it("keeps a visible fallback phone for browser direct conversations", () => {
    expect(phoneFromConversationJid("34600000000@c.us")).toBe("+34600000000");
    expect(phoneFromConversationJid("123456789@lid")).toBeNull();
  });
});
