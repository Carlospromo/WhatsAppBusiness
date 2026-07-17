import { describe, expect, it } from "vitest";
import { sessionCookieOptions } from "../lib/session-config";
import { hashSessionToken } from "../lib/token";

describe("sessions", () => {
  it("stores a deterministic keyed hash instead of the raw token", () => {
    process.env.AUTH_SECRET = "a".repeat(32);
    const token = "session-token";
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it("uses an HttpOnly, same-site cookie", () => {
    const options = sessionCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
  });
});
