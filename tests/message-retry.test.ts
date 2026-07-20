import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("../lib/prisma", () => ({ prisma: { message: { findUnique: mocks.findUnique } } }));

import { getOutboundMessageForRetry } from "../lib/whatsapp/message-retry";

describe("outbound retry recovery", () => {
  beforeEach(() => mocks.findUnique.mockReset());

  it("rebuilds only a stored outbound text message", async () => {
    mocks.findUnique.mockResolvedValue({ direction: "OUTBOUND", messageType: "text", body: "texto persistido" });
    await expect(getOutboundMessageForRetry("account-1", "message-1")).resolves.toEqual({ conversation: "texto persistido" });
  });

  it("does not return inbound, media, empty or unknown messages", async () => {
    mocks.findUnique.mockResolvedValueOnce({ direction: "INBOUND", messageType: "text", body: "no" });
    await expect(getOutboundMessageForRetry("account-1", "message-1")).resolves.toBeUndefined();
    mocks.findUnique.mockResolvedValueOnce({ direction: "OUTBOUND", messageType: "image", body: "" });
    await expect(getOutboundMessageForRetry("account-1", "message-2")).resolves.toBeUndefined();
    await expect(getOutboundMessageForRetry("account-1", undefined)).resolves.toBeUndefined();
  });
});
