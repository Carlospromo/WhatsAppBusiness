import { describe, expect, it } from "vitest";
import { validateMessageBody, parseCursor } from "../lib/inbox";
import { canManageMessages, canSendMessages } from "../lib/authorization";

describe("inbox safety", () => {
  it("validates manual text and cursor values", () => { expect(validateMessageBody(" hola ")).toBe("hola"); expect(validateMessageBody(" ")).toBeNull(); expect(validateMessageBody("x".repeat(2001))).toBeNull(); expect(parseCursor("bad!")).toBeUndefined(); });
  it("keeps viewers read-only", () => { expect(canSendMessages("VIEWER")).toBe(false); expect(canManageMessages("VIEWER")).toBe(false); expect(canSendMessages("AGENT")).toBe(true); });
});
