import { describe, expect, it } from "vitest";
import { isTrustedProfilePictureUrl } from "../lib/whatsapp/profile-picture-url";

describe("WhatsApp profile picture URLs", () => {
  it("allows only trusted HTTPS providers", () => {
    expect(isTrustedProfilePictureUrl("https://pps.whatsapp.net/v/t61.24694-24/example")).toBe(true);
    expect(isTrustedProfilePictureUrl("https://scontent.xx.fbcdn.net/example")).toBe(true);
    expect(isTrustedProfilePictureUrl("http://pps.whatsapp.net/example")).toBe(false);
    expect(isTrustedProfilePictureUrl("https://example.com/image.png")).toBe(false);
    expect(isTrustedProfilePictureUrl("https://user:password@pps.whatsapp.net/example")).toBe(false);
  });
});
