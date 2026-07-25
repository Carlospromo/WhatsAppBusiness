import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("WhatsApp Web worker runtime", () => {
  it("uses only the compiled browser bridge", () => {
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
    const patch = readFileSync(new URL("../patches/whatsapp-web.js+1.34.7.patch", import.meta.url), "utf8");
    expect(packageJson).toContain('"whatsapp-web.js": "https://codeload.github.com/wwebjs/whatsapp-web.js/tar.gz/1780711a1c86dfeca7c5ba6a66f950eac93dde28"');
    expect(Object.keys(JSON.parse(packageJson).dependencies ?? {}).some((name) => name.startsWith("@whiskey"))).toBe(false);
    expect(worker).toContain('from "whatsapp-web.js"');
    expect(worker).toContain('webVersionCache: { type: "none" }');
    expect(worker).toContain("WA_WEB_READY_PROBE_DELAY_SECONDS");
    expect(worker).toContain("WA_WEB_HEALTHCHECK_SECONDS");
    expect(worker).toContain("getContactLidAndPhone([conversationJid])");
    expect(worker).toContain("inbound.event_listeners_registered");
    expect(worker).toContain("inbound.normalized");
    expect(worker).toContain("inbound.persistence_failed");
    expect(worker).toContain("conversationResolution");
    expect(worker).toContain('source === "state_probe" && !(await primeInboundReconciliation(accountId, client))');
    expect(worker).toContain("inboundReconciliationDisabled");
    expect(patch).toContain("Promise.allSettled");
    expect(packageJson).toContain('"postinstall": "patch-package"');
    expect(worker).not.toContain(["relay", "Message"].join(""));
  });
});
