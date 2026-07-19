import { describe, expect, it } from "vitest";
import { messagesFromNewestPage, validateMessageBody, parseCursor } from "../lib/inbox";
import { canManageMessages, canSendMessages } from "../lib/authorization";

describe("inbox safety", () => {
  it("validates manual text and cursor values", () => { expect(validateMessageBody(" hola ")).toBe("hola"); expect(validateMessageBody(" ")).toBeNull(); expect(validateMessageBody("x".repeat(2001))).toBeNull(); expect(parseCursor("bad!")).toBeUndefined(); });
  it("keeps viewers read-only", () => { expect(canSendMessages("VIEWER")).toBe(false); expect(canManageMessages("VIEWER")).toBe(false); expect(canSendMessages("AGENT")).toBe(true); });
  it("uses the oldest visible message as cursor without dropping it", () => {
    const results = Array.from({ length: 4 }, (_, index) => ({ id: `message-${4 - index}` }));
    expect(messagesFromNewestPage(results, 3)).toEqual({ messages: [{ id: "message-2" }, { id: "message-3" }, { id: "message-4" }], nextCursor: "message-2" });
  });
});
