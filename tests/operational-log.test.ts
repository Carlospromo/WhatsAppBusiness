import { describe, expect, it } from "vitest";
import { safeErrorInfo, safeLogRef } from "../lib/operational-log";

describe("operational log privacy", () => {
  it("uses stable one-way references", () => {
    const ref = safeLogRef("secret-message-or-phone");
    expect(ref).toHaveLength(12);
    expect(ref).not.toContain("secret-message-or-phone");
    expect(safeLogRef("secret-message-or-phone")).toBe(ref);
  });

  it("keeps only safe transport metadata from errors", () => {
    expect(safeErrorInfo({ name: "Boom", code: "ECONNRESET", message: "contains a phone 34600000000", output: { statusCode: 408 } })).toEqual({ errorType: "Boom", errorCode: "ECONNRESET", statusCode: 408 });
  });
});
