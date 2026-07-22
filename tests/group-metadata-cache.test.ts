import { describe, expect, it } from "vitest";
import { GroupMetadataCache } from "../lib/whatsapp/group-metadata-cache";

describe("group metadata cache", () => {
  it("reuses one metadata query while an entry is valid", async () => {
    const cache = new GroupMetadataCache(60_000);
    const metadata = { id: "group@g.us", participants: [] } as never;
    const socket = { groupMetadata: async () => metadata };

    await expect(cache.ensure(socket, "group@g.us")).resolves.toBe(metadata);
    await expect(cache.ensure({ groupMetadata: async () => { throw new Error("should not fetch"); } }, "group@g.us")).resolves.toBe(metadata);
  });

  it("does not retain a failed metadata query", async () => {
    const cache = new GroupMetadataCache();
    await expect(cache.ensure({ groupMetadata: async () => { throw new Error("unavailable"); } }, "group@g.us")).resolves.toBeUndefined();
    expect(cache.get("group@g.us")).toBeUndefined();
  });
});
