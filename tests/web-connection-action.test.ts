import { describe, expect, it } from "vitest";
import { requestedWebConnectionAction } from "../lib/whatsapp/web-connection-action";

describe("WhatsApp Web connection actions", () => {
  it("treats an unspecified or legacy non-relink request as a safe retry", () => {
    expect(requestedWebConnectionAction({})).toBe("retry");
    expect(requestedWebConnectionAction({ relink: false })).toBe("retry");
    expect(requestedWebConnectionAction({ action: "retry" })).toBe("retry");
  });

  it("requires an explicit relink action before the worker may remove LocalAuth", () => {
    expect(requestedWebConnectionAction({ relink: true })).toBe("relink");
    expect(requestedWebConnectionAction({ action: "relink" })).toBe("relink");
  });
});
