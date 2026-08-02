import { describe, expect, it } from "vitest";
import { conversationPage, conversationPageSize, subsequentConversationPageSize, directConversationJid, messagesFromNewestPage, validateMessageBody, parseCursor } from "../lib/inbox";
import { canManageMessages, canSendMessages } from "../lib/authorization";
import { outboundDestinationJid, resolveOutboundDestination } from "../lib/whatsapp/outbound-destination";
import { WhatsAppBridgeType } from "@prisma/client";

describe("inbox safety", () => {
  it("validates manual text and cursor values", () => { expect(validateMessageBody(" hola ")).toBe("hola"); expect(validateMessageBody(" ")).toBeNull(); expect(validateMessageBody("x".repeat(2001))).toBeNull(); expect(parseCursor("bad!")).toBeUndefined(); });
  it("uses a useful first page and smaller subsequent pages without an inbox maximum", () => { expect(conversationPageSize).toBe(100); expect(subsequentConversationPageSize).toBe(50); });
  it("uses the last visible conversation as cursor without skipping the next one", () => {
    const page = conversationPage([{ id: "a" }, { id: "b" }, { id: "c" }], 2);
    expect(page).toEqual({ rows: [{ id: "a" }, { id: "b" }], nextCursor: "b" });
  });
  it("creates direct browser chat ids only from normalized phone numbers", () => { expect(directConversationJid("+34600000000")).toBe("34600000000@c.us"); expect(directConversationJid("600000000")).toBeNull(); expect(directConversationJid("+00123")).toBeNull(); });
  it("uses browser chat identities or a verified phone for direct conversations", () => {
    expect(outboundDestinationJid({ jid: "123456789@lid", type: "DIRECT", contact: { phone: "+34600000000" } })).toBe("34600000000@c.us");
    expect(outboundDestinationJid({ jid: "123456789@lid", type: "DIRECT", contact: null })).toBeNull();
    expect(outboundDestinationJid({ jid: "legacy@unknown", type: "DIRECT", contact: { phone: "+34600000000" } })).toBe("34600000000@c.us");
    expect(outboundDestinationJid({ jid: "group@g.us", type: "GROUP" })).toBe("group@g.us");
    expect(outboundDestinationJid({ jid: "legacy@unknown", type: "DIRECT", externalIdentities: [{ bridgeType: WhatsAppBridgeType.WWEBJS, externalChatId: "34600000000@c.us" }] })).toBe("34600000000@c.us");
    expect(resolveOutboundDestination({ jid: "123456789@lid", type: "DIRECT", contact: { phone: "+34600000000" } })).toEqual({ jid: "34600000000@c.us", kind: "direct", phoneFallbackPresent: true });
    expect(resolveOutboundDestination({ jid: "unknown", type: "DIRECT", contact: null })).toEqual({ jid: null, kind: "unknown", phoneFallbackPresent: false });
  });
  it("keeps viewers read-only", () => { expect(canSendMessages("VIEWER")).toBe(false); expect(canManageMessages("VIEWER")).toBe(false); expect(canSendMessages("AGENT")).toBe(true); });
  it("uses the oldest visible message as cursor without dropping it", () => {
    const results = Array.from({ length: 4 }, (_, index) => ({ id: `message-${4 - index}` }));
    expect(messagesFromNewestPage(results, 3)).toEqual({ messages: [{ id: "message-2" }, { id: "message-3" }, { id: "message-4" }], nextCursor: "message-2" });
  });
});
