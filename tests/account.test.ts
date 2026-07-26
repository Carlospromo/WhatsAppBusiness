import { describe, expect, it } from "vitest";
import { validAccountName, validAccountSlug } from "../lib/account";

describe("account settings validation", () => {
  it("accepts a trimmed visible account name and rejects empty or oversized names", () => {
    expect(validAccountName("  Atención comercial  ")).toBe("Atención comercial");
    expect(validAccountName("   ")).toBeNull();
    expect(validAccountName("a".repeat(81))).toBeNull();
  });

  it("keeps account slugs stable and separate from the visible name", () => {
    expect(validAccountSlug("atencion-comercial")).toBe("atencion-comercial");
    expect(validAccountSlug("Atencion Comercial")).toBeNull();
  });
});
