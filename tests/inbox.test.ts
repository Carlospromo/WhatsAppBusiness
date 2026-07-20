import { describe, expect, it } from "vitest";
import { directConversationJid, messagesFromNewestPage, validateMessageBody, parseCursor } from "../lib/inbox";
import { canManageMessages, canSendMessages } from "../lib/authorization";
import { outboundDestinationJid } from "../lib/whatsapp/outbound-destination";

describe("inbox safety", () => {
  it("validates manual text and cursor values", () => { expect(validateMessageBody(" hola ")).toBe("hola"); expect(validateMessageBody(" ")).toBeNull(); expect(validateMessageBody("x".repeat(2001))).toBeNull(); expect(parseCursor("bad!")).toBeUndefined(); });
  it("creates direct conversation JIDs only from normalized phone numbers", () => { expect(directConversationJid("+34600000000")).toBe("34600000000@s.whatsapp.net"); expect(directConversationJid("600000000")).toBeNull(); expect(directConversationJid("+00123")).toBeNull(); });
  it("sends a direct LID conversation to its resolved phone JID", () => {
    expect(outboundDestinationJid({ jid: "123456789@lid", type: "DIRECT", contact: { phone: "+34600000000" } })).toBe("34600000000@s.whatsapp.net");
    expect(outboundDestinationJid({ jid: "123456789@lid", type: "DIRECT", contact: null })).toBeNull();
    expect(outboundDestinationJid({ jid: "group@g.us", type: "GROUP" })).toBe("group@g.us");
  });
  it("keeps viewers read-only", () => { expect(canSendMessages("VIEWER")).toBe(false); expect(canManageMessages("VIEWER")).toBe(false); expect(canSendMessages("AGENT")).toBe(true); });
  it("uses the oldest visible message as cursor without dropping it", () => {
    const results = Array.from({ length: 4 }, (_, index) => ({ id: `message-${4 - index}` }));
    expect(messagesFromNewestPage(results, 3)).toEqual({ messages: [{ id: "message-2" }, { id: "message-3" }, { id: "message-4" }], nextCursor: "message-2" });
  });
});
