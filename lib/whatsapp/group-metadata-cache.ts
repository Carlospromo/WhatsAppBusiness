import type { GroupMetadata } from "@whiskeysockets/baileys";

const DEFAULT_TTL_MS = 5 * 60 * 1_000;

type CacheEntry = {
  metadata: GroupMetadata;
  expiresAt: number;
};

type GroupMetadataSocket = {
  groupMetadata: (jid: string) => Promise<GroupMetadata>;
};

/**
 * Keeps group participant lists in memory per WhatsApp account. Baileys uses
 * this callback while encrypting a group message, avoiding repeated metadata
 * queries for every manual send.
 */
export class GroupMetadataCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<GroupMetadata | undefined>>();

  constructor(private readonly ttlMs = DEFAULT_TTL_MS) {}

  get(jid: string) {
    const entry = this.entries.get(jid);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.entries.delete(jid);
      return undefined;
    }
    return entry.metadata;
  }

  set(metadata: GroupMetadata) {
    if (!metadata.id || !Array.isArray(metadata.participants)) return;
    this.entries.set(metadata.id, { metadata, expiresAt: Date.now() + this.ttlMs });
  }

  async ensure(socket: GroupMetadataSocket, jid: string) {
    const cached = this.get(jid);
    if (cached) return cached;
    const existing = this.inFlight.get(jid);
    if (existing) return existing;

    const fetch = socket.groupMetadata(jid)
      .then((metadata) => {
        this.set(metadata);
        return metadata;
      })
      .catch(() => undefined)
      .finally(() => this.inFlight.delete(jid));
    this.inFlight.set(jid, fetch);
    return fetch;
  }

  clear() {
    this.entries.clear();
    this.inFlight.clear();
  }
}

const caches = new Map<string, GroupMetadataCache>();

export function groupMetadataCacheForAccount(accountId: string) {
  let cache = caches.get(accountId);
  if (!cache) {
    cache = new GroupMetadataCache();
    caches.set(accountId, cache);
  }
  return cache;
}

export function clearGroupMetadataCache(accountId: string) {
  caches.get(accountId)?.clear();
  caches.delete(accountId);
}
