import { describe, expect, it } from "vitest";
import { canManageMessages } from "../lib/authorization";
import { readReceiptRetryAt } from "../lib/whatsapp/read-receipts";

describe("WhatsApp read receipts", () => {
  it("keeps VIEWER read-only", () => {
    expect(canManageMessages("VIEWER")).toBe(false);
    expect(canManageMessages("AGENT")).toBe(true);
  });

  it("uses a durable request rather than bridge-specific message keys", () => {
    expect(readReceiptRetryAt(null, 0)).toEqual(new Date(0));
  });

  it("backs off retries without changing a pending request to failed immediately", () => {
    expect(readReceiptRetryAt(new Date("2026-01-01T00:00:00.000Z"), 1)).toEqual(new Date("2026-01-01T00:00:02.000Z"));
    expect(readReceiptRetryAt(null, 0)).toEqual(new Date(0));
  });
});
