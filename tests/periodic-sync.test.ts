import { describe, expect, it } from "vitest";
import { canOpenSocket, periodicSyncConfig } from "../lib/whatsapp/periodic-sync";

describe("periodic WhatsApp synchronization", () => {
  it("uses bounded, resource-conscious defaults", () => {
    expect(periodicSyncConfig({})).toEqual({
      intervalMs: 300_000,
      windowMs: 45_000,
      accountCheckMs: 15_000,
      linkWindowMs: 120_000,
    });
  });

  it("accepts explicit intervals but rejects an invalid window", () => {
    expect(periodicSyncConfig({
      WA_SYNC_INTERVAL_SECONDS: "600",
      WA_SYNC_WINDOW_SECONDS: "60",
      WA_ACCOUNT_CHECK_SECONDS: "20",
      WA_LINK_WINDOW_SECONDS: "180",
    })).toMatchObject({ intervalMs: 600_000, windowMs: 60_000, accountCheckMs: 20_000, linkWindowMs: 180_000 });
    expect(() => periodicSyncConfig({ WA_SYNC_INTERVAL_SECONDS: "60", WA_SYNC_WINDOW_SECONDS: "60" })).toThrow("menor");
  });

  it("does not permit an idle account to open a socket", () => {
    expect(canOpenSocket(false, false)).toBe(false);
    expect(canOpenSocket(true, false)).toBe(true);
    expect(canOpenSocket(false, true)).toBe(true);
  });
});
