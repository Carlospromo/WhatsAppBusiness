import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("WhatsApp Web worker runtime", () => {
  it("uses the compiled browser bridge and not the legacy dependency", () => {
    const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
    expect(packageJson).toContain('"whatsapp-web.js": "1.34.7"');
    expect(packageJson).not.toContain("@whiskeysockets/baileys");
    expect(worker).toContain('from "whatsapp-web.js"');
    expect(worker).not.toContain("relayMessage");
  });
});
