import { describe, expect, it } from "vitest";
import { outboundSafetyLimits, safeOutboundSafetyMessage } from "../lib/whatsapp/outbound-safety";
import { MAX_OUTBOUND_ATTEMPTS, OUTBOUND_CONFIRMATION_TIMEOUT_MESSAGE, OUTBOUND_CONFIRMATION_TIMEOUT_MS } from "../lib/whatsapp/outbound-confirmation";

describe("outbound safety limits", () => {
  it("uses conservative defaults", () => {
    expect(outboundSafetyLimits({})).toEqual({
      maxPending: 10,
      maxPerMinute: 3,
      minIntervalMs: 15_000,
      maxNewChatsPerDay: 3,
    });
  });

  it("accepts bounded explicit values and rejects unsafe configuration", () => {
    expect(outboundSafetyLimits({
      WA_OUTBOUND_MAX_PENDING: "25",
      WA_OUTBOUND_MAX_PER_MINUTE: "4",
      WA_OUTBOUND_MIN_INTERVAL_SECONDS: "12",
      WA_OUTBOUND_MAX_NEW_CHATS_PER_DAY: "7",
    })).toEqual({ maxPending: 25, maxPerMinute: 4, minIntervalMs: 12_000, maxNewChatsPerDay: 7 });
    expect(() => outboundSafetyLimits({ WA_OUTBOUND_MAX_PER_MINUTE: "0" })).toThrow("WA_OUTBOUND_MAX_PER_MINUTE");
    expect(() => outboundSafetyLimits({ WA_OUTBOUND_MIN_INTERVAL_SECONDS: "5" })).toThrow("WA_OUTBOUND_MIN_INTERVAL_SECONDS");
  });

  it("returns a safe message without technical restriction details", () => {
    expect(safeOutboundSafetyMessage("RESTRICTED")).toContain("restringido");
    expect(safeOutboundSafetyMessage("RATE_LIMIT")).not.toContain("463");
  });

  it("does not silently retry a request without a final WhatsApp confirmation", () => {
    expect(MAX_OUTBOUND_ATTEMPTS).toBe(3);
    expect(OUTBOUND_CONFIRMATION_TIMEOUT_MS).toBe(15 * 60 * 1_000);
    expect(OUTBOUND_CONFIRMATION_TIMEOUT_MESSAGE).toContain("No se reintentó");
  });
});
