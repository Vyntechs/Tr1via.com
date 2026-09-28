// In-memory RateStore for tests — same contract as the Supabase store.

import type { RateBucket, RateStore } from "@/lib/auth/rate-limits";

export interface RateEvent {
  id: string;
  bucket: RateBucket;
  keyHash: string;
  createdAt: string;
}

export function memoryRateStore(): RateStore & { events: RateEvent[] } {
  const events: RateEvent[] = [];
  let n = 0;
  return {
    events,
    async count(bucket, keyHash, sinceIso) {
      return events.filter((e) => e.bucket === bucket && e.keyHash === keyHash && e.createdAt >= sinceIso)
        .length;
    },
    async record(bucket, keyHash, nowIso) {
      const id = `event-${++n}`;
      events.push({ id, bucket, keyHash, createdAt: nowIso });
      return id;
    },
    async clear(bucket, keyHash) {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].bucket === bucket && events[i].keyHash === keyHash) events.splice(i, 1);
      }
    },
    async forget(id) {
      const i = events.findIndex((e) => e.id === id);
      if (i >= 0) events.splice(i, 1);
    },
    async deleteOlderThan(beforeIso) {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].createdAt < beforeIso) events.splice(i, 1);
    },
  };
}
