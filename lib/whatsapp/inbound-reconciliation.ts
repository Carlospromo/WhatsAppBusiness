export type ChatWatermarkSnapshot = {
  id: string;
  timestamp: number;
};

export type ChangedChatWatermark = ChatWatermarkSnapshot & {
  previousTimestamp: number | null;
};

function validSnapshot(snapshot: ChatWatermarkSnapshot) {
  return Boolean(snapshot.id) && Number.isSafeInteger(snapshot.timestamp) && snapshot.timestamp >= 0;
}

/**
 * Establishes a baseline without importing old history. Subsequent polling
 * only touches chats whose activity timestamp advanced after this point.
 */
export function seedChatWatermarks(snapshots: ChatWatermarkSnapshot[]) {
  const watermarks = new Map<string, number>();
  for (const snapshot of snapshots) if (validSnapshot(snapshot)) watermarks.set(snapshot.id, snapshot.timestamp);
  return watermarks;
}

export function changedChatWatermarks(watermarks: Map<string, number>, snapshots: ChatWatermarkSnapshot[]) {
  const changed: ChangedChatWatermark[] = [];
  for (const snapshot of snapshots) {
    if (!validSnapshot(snapshot)) continue;
    const previousTimestamp = watermarks.get(snapshot.id) ?? null;
    watermarks.set(snapshot.id, snapshot.timestamp);
    if (previousTimestamp === null || snapshot.timestamp > previousTimestamp) changed.push({ ...snapshot, previousTimestamp });
  }
  return changed;
}
