// Supabase-backed RateStore for lib/auth/rate-limits.ts. Service role only:
// public.auth_rate_events has RLS on, no policies, and no browser grants
// (migration 20260927210000_auth_rate_events.sql).
//
// That migration is written but not yet applied anywhere, so the table isn't
// in the generated lib/supabase/types.ts. Until it is (apply, then
// `npm run typegen`), this one file talks to it through an untyped view of
// the admin client. Every other file goes through the RateStore interface.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RateStore } from "@/lib/auth/rate-limits";

const TABLE = "auth_rate_events";

function check(error: { message: string } | null, what: string) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

export function supabaseRateStore(
  client: SupabaseClient = getSupabaseAdmin() as unknown as SupabaseClient,
): RateStore {
  const t = () => client.from(TABLE);
  return {
    async count(bucket, keyHash, sinceIso) {
      const { count, error } = await t()
        .select("id", { count: "exact", head: true })
        .eq("bucket", bucket)
        .eq("key_hash", keyHash)
        .gte("created_at", sinceIso);
      check(error, "count events");
      return count ?? 0;
    },
    async record(bucket, keyHash, nowIso) {
      const { error } = await t().insert({ bucket, key_hash: keyHash, created_at: nowIso });
      check(error, "record event");
    },
    async clear(bucket, keyHash) {
      const { error } = await t().delete().eq("bucket", bucket).eq("key_hash", keyHash);
      check(error, "clear events");
    },
    async deleteOlderThan(beforeIso) {
      const { error } = await t().delete().lt("created_at", beforeIso);
      check(error, "clean up events");
    },
  };
}
