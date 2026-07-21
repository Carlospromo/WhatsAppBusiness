import { describe, expect, it } from "vitest";
import { canOpenSocket, periodicSyncConfig } from "../lib/whatsapp/periodic-sync";

describe("periodic WhatsApp synchronization", () => {
  it("uses bounded, resource-conscious defaults", () => {
    expect(periodicSyncConfig({})).toEqual({
      mode: "continuous",
      intervalMs: 0,
      windowMs: 0,
      connectTimeoutMs: 0,
      accountCheckMs: 15_000,
      linkWindowMs: 120_000,
    });
  });

  it("keeps a continuous connection even when obsolete periodic values are present", () => {
    expect(periodicSyncConfig({
      WA_SYNC_INTERVAL_SECONDS: "5",
      WA_SYNC_WINDOW_SECONDS: "45",
      WA_SYNC_CONNECT_TIMEOUT_SECONDS: "45",
    })).toMatchObject({ mode: "continuous", intervalMs: 0, windowMs: 0, connectTimeoutMs: 0 });
  });

  it("accepts explicit intervals but rejects an invalid window", () => {
    expect(periodicSyncConfig({
      WA_CONNECTION_MODE: "periodic",
      WA_SYNC_INTERVAL_SECONDS: "600",
      WA_SYNC_WINDOW_SECONDS: "60",
      WA_SYNC_CONNECT_TIMEOUT_SECONDS: "60",
      WA_ACCOUNT_CHECK_SECONDS: "20",
      WA_LINK_WINDOW_SECONDS: "180",
    })).toMatchObject({ mode: "periodic", intervalMs: 600_000, windowMs: 60_000, connectTimeoutMs: 60_000, accountCheckMs: 20_000, linkWindowMs: 180_000 });
    expect(() => periodicSyncConfig({ WA_CONNECTION_MODE: "periodic", WA_SYNC_INTERVAL_SECONDS: "60", WA_SYNC_WINDOW_SECONDS: "45", WA_SYNC_CONNECT_TIMEOUT_SECONDS: "45" })).toThrow("no puede superar");
  });

  it("does not permit an idle account to open a socket", () => {
    expect(canOpenSocket("periodic", false, false)).toBe(false);
    expect(canOpenSocket("periodic", true, false)).toBe(true);
    expect(canOpenSocket("periodic", false, true)).toBe(true);
    expect(canOpenSocket("continuous", false, false)).toBe(true);
  });
});
