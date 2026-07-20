import { describe, expect, it } from "vitest";
import { validRecoveryRange } from "../lib/history-recovery";

describe("controlled history recovery", () => {
  it("accepts a bounded past range", () => {
    const result = validRecoveryRange("2026-01-01T00:00:00.000Z", "2026-01-07T23:59:59.999Z");
    expect(result?.fromAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("rejects future, inverted, and overly broad ranges", () => {
    expect(validRecoveryRange("2026-02-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBeNull();
    expect(validRecoveryRange("2026-01-01T00:00:00.000Z", "2026-03-15T00:00:00.000Z")).toBeNull();
    expect(validRecoveryRange("not-a-date", "2026-01-01T00:00:00.000Z")).toBeNull();
  });
});
