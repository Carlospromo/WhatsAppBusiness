import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearStaleWebSessionLocks, hasWebSessionProfile, webSessionProfilePath } from "../lib/whatsapp/web-session";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WhatsApp Web session profile", () => {
  it("uses an account-isolated profile path", () => {
    expect(webSessionProfilePath("account/one", "/data/wwebjs-auth")).toBe(join("/data/wwebjs-auth", "session-account_one"));
  });

  it("removes only stale Chromium lock entries and preserves the profile", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwebjs-profile-"));
    roots.push(root);
    const profile = webSessionProfilePath("account-one", root);
    await mkdir(join(profile, "Default"), { recursive: true });
    await writeFile(join(profile, "Default", "Cookies"), "session-data");
    await Promise.all(["SingletonLock", "SingletonCookie", "SingletonSocket"].map((name) => writeFile(join(profile, name), "stale")));

    expect(await hasWebSessionProfile("account-one", root)).toBe(true);
    expect(await clearStaleWebSessionLocks("account-one", root)).toBe(3);
    await expect(access(join(profile, "Default", "Cookies"))).resolves.toBeUndefined();
    await expect(access(join(profile, "SingletonLock"))).rejects.toBeDefined();
  });

  it("does not report a cleanup when a reusable profile has no stale locks", async () => {
    const root = await mkdtemp(join(tmpdir(), "wwebjs-profile-"));
    roots.push(root);
    await mkdir(webSessionProfilePath("account-one", root), { recursive: true });
    expect(await clearStaleWebSessionLocks("account-one", root)).toBe(0);
  });
});
