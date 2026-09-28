// In-memory RateStore for tests — same contract as the Supabase store.

import type { RateBucket, RateStore } from "@/lib/auth/rate-limits";

export interface RateEvent {
  bucket: RateBucket;
  keyHash: string;
  createdAt: string;
}

export function memoryRateStore(): RateStore & { events: RateEvent[] } {
  const events: RateEvent[] = [];
  return {
    events,
    async count(bucket, keyHash, sinceIso) {
      return events.filter((e) => e.bucket === bucket && e.keyHash === keyHash && e.createdAt >= sinceIso)
        .length;
    },
    async record(bucket, keyHash, nowIso) {
      events.push({ bucket, keyHash, createdAt: nowIso });
    },
    async clear(bucket, keyHash) {
      for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].bucket === bucket && events[i].keyHash === keyHash) events.splice(i, 1);
      }
    },
    async forget(bucket, keyHash, atIso) {
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e.bucket === bucket && e.keyHash === keyHash && e.createdAt === atIso) events.splice(i, 1);
      }
    },
    async deleteOlderThan(beforeIso) {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].createdAt < beforeIso) events.splice(i, 1);
    },
  };
}
