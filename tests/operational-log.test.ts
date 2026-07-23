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
    const result = safeErrorInfo({ name: "Boom", code: "ECONNRESET", message: "contains a phone 34600000000", output: { statusCode: 408 } });
    expect(result).toMatchObject({ errorType: "Boom", errorCode: "ECONNRESET", statusCode: 408, errorCategory: undefined });
    expect(JSON.stringify(result)).not.toContain("34600000000");
    expect(result.errorFingerprint).toMatch(/^[a-f0-9]{12}$/);
  });

  it("classifies string failures without logging their raw value", () => {
    const result = safeErrorInfo("ready timeout");
    expect(result).toMatchObject({ errorType: "Error", errorCode: undefined, statusCode: undefined, errorCategory: "WWEBJS_READY_TIMEOUT" });
    expect(JSON.stringify(result)).not.toContain("ready timeout");
  });
});
