import { afterEach, describe, expect, it, vi } from "vitest";
import { TransientPresenceManager } from "../lib/whatsapp/transient-presence";

describe("transient WhatsApp presence", () => {
  afterEach(() => vi.useRealTimers());

  it("is unavailable while idle and briefly available only during activity", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const socket = { sendPresenceUpdate: async (state: "available" | "unavailable") => { sent.push(state); } };
    const presence = new TransientPresenceManager(3_000);

    await presence.markIdle("account", socket);
    await presence.duringActivity("account", socket, async () => undefined);
    expect(sent).toEqual(["unavailable", "available"]);

    await vi.advanceTimersByTimeAsync(2_999);
    expect(sent).toEqual(["unavailable", "available"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual(["unavailable", "available", "unavailable"]);
  });

  it("keeps the account available while overlapping work is still active", async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const socket = { sendPresenceUpdate: async (state: "available" | "unavailable") => { sent.push(state); } };
    const presence = new TransientPresenceManager(3_000);
    let release!: () => void;
    const ongoing = presence.duringActivity("account", socket, () => new Promise<void>((resolve) => { release = resolve; }));
    await vi.runAllTicks();
    await presence.duringActivity("account", socket, async () => undefined);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sent).toEqual(["available"]);
    release();
    await ongoing;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sent).toEqual(["available", "unavailable"]);
  });
});
