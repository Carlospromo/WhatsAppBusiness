import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("WhatsApp Web worker runtime", () => {
  it("uses only the compiled browser bridge", () => {
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
    expect(packageJson).toContain('"whatsapp-web.js": "https://codeload.github.com/wwebjs/whatsapp-web.js/tar.gz/1780711a1c86dfeca7c5ba6a66f950eac93dde28"');
    expect(Object.keys(JSON.parse(packageJson).dependencies ?? {}).some((name) => name.startsWith("@whiskey"))).toBe(false);
    expect(worker).toContain('from "whatsapp-web.js"');
    expect(worker).toContain('webVersionCache: { type: "none" }');
    expect(worker).toContain("WA_WEB_READY_PROBE_DELAY_SECONDS");
    expect(worker).not.toContain(["relay", "Message"].join(""));
  });
});
