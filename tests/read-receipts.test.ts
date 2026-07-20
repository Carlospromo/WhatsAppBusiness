import { describe, expect, it } from "vitest";
import { canManageMessages } from "../lib/authorization";
import { readReceiptKeys, readReceiptRetryAt, receiptMessageIds } from "../lib/whatsapp/read-receipts";

describe("WhatsApp read receipts", () => {
  it("keeps VIEWER read-only", () => {
    expect(canManageMessages("VIEWER")).toBe(false);
    expect(canManageMessages("AGENT")).toBe(true);
  });

  it("creates keys for direct chats without exposing a participant", () => {
    expect(readReceiptKeys(
      { jid: "123@s.whatsapp.net", type: "DIRECT" },
      [{ externalId: "message-1", direction: "INBOUND", receiptParticipant: null }],
    )).toEqual([{ remoteJid: "123@s.whatsapp.net", id: "message-1" }]);
  });

  it("preserves the technical group participant and skips legacy messages without one", () => {
    expect(readReceiptKeys(
      { jid: "group@g.us", type: "GROUP" },
      [
        { externalId: "message-1", direction: "INBOUND", receiptParticipant: "sender@lid" },
        { externalId: "message-2", direction: "INBOUND", receiptParticipant: null },
      ],
    )).toEqual([{ remoteJid: "group@g.us", id: "message-1", participant: "sender@lid" }]);
  });

  it("does not create a receipt for no unread messages and de-duplicates selected messages", () => {
    expect(receiptMessageIds("DIRECT", [])).toEqual([]);
    expect(receiptMessageIds("DIRECT", [{ id: "message-1", receiptParticipant: null }, { id: "message-1", receiptParticipant: null }])).toEqual(["message-1"]);
  });

  it("backs off retries without changing a pending request to failed immediately", () => {
    expect(readReceiptRetryAt(new Date("2026-01-01T00:00:00.000Z"), 1)).toEqual(new Date("2026-01-01T00:00:02.000Z"));
    expect(readReceiptRetryAt(null, 0)).toEqual(new Date(0));
  });
});
