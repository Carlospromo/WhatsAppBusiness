import { WhatsAppConnectionStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";

describe("WhatsApp connection states", () => {
  it("includes the supported lifecycle states", () => {
    expect(Object.values(WhatsAppConnectionStatus)).toEqual([
      "DISCONNECTED", "WAITING_FOR_QR", "CONNECTING", "CONNECTED", "ERROR",
    ]);
  });
});
