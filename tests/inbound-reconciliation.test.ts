import { describe, expect, it } from "vitest";
import { changedChatWatermarks, seedChatWatermarks } from "../lib/whatsapp/inbound-reconciliation";

describe("WhatsApp Web inbound reconciliation", () => {
  it("creates a baseline without importing already existing chats", () => {
    const watermarks = seedChatWatermarks([{ id: "one@c.us", timestamp: 100 }]);
    expect(changedChatWatermarks(watermarks, [{ id: "one@c.us", timestamp: 100 }])).toEqual([]);
  });

  it("returns only chats with newer activity and retains their previous timestamp", () => {
    const watermarks = seedChatWatermarks([{ id: "one@c.us", timestamp: 100 }]);
    expect(changedChatWatermarks(watermarks, [{ id: "one@c.us", timestamp: 101 }, { id: "two@c.us", timestamp: 102 }]))
      .toEqual([{ id: "one@c.us", timestamp: 101, previousTimestamp: 100 }, { id: "two@c.us", timestamp: 102, previousTimestamp: null }]);
  });
});
