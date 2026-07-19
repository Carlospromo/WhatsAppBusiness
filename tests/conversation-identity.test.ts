import { describe, expect, it } from "vitest";
import { phoneFromConversationJid, visibleConversation } from "../lib/conversation-identity";

describe("legacy conversation identity", () => {
  it("derives a displayable phone without exposing the WhatsApp JID", () => {
    const conversation = visibleConversation({
      id: "conversation-1",
      jid: "34600000000@s.whatsapp.net",
      contact: null,
    });
    expect(conversation).toEqual({
      id: "conversation-1",
      contact: { id: null, displayName: null, pushName: null, phone: "+34600000000", profilePictureUpdatedAt: null, addressBookContact: null },
    });
    expect(phoneFromConversationJid("group@g.us")).toBeNull();
  });
});
