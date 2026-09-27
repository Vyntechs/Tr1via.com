// Supabase-backed CodeStore for lib/auth/email-codes.ts. Service role only:
// public.auth_email_codes has RLS on, no policies, and no browser grants
// (migration 20260927120000_auth_email_codes.sql).
//
// The table isn't in the generated lib/supabase/types.ts yet (typegen needs
// the migration applied to a local stack), so this one file talks to it
// through an untyped view of the admin client. Every other file goes
// through the CodeStore interface.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CodePurpose, CodeRow, CodeStore, NewCodeRow } from "@/lib/auth/email-codes";

const TABLE = "auth_email_codes";

export class CodeStoreError extends Error {}

function check(error: { message: string } | null, what: string) {
  if (error) throw new CodeStoreError(`${what}: ${error.message}`);
}

export function supabaseCodeStore(
  client: SupabaseClient = getSupabaseAdmin() as unknown as SupabaseClient,
): CodeStore {
  const t = () => client.from(TABLE);
  return {
    async countSince(email, sinceIso) {
      let q = t().select("id", { count: "exact", head: true }).gte("created_at", sinceIso);
      if (email) q = q.eq("email", email);
      const { count, error } = await q;
      check(error, "count codes");
      return count ?? 0;
    },
    async retireActive(email: string, purpose: CodePurpose, nowIso: string) {
      const { error } = await t()
        .update({ consumed_at: nowIso })
        .eq("email", email)
        .eq("purpose", purpose)
        .is("consumed_at", null);
      check(error, "retire codes");
    },
    async insert(row: NewCodeRow) {
      const { error } = await t().insert(row);
      check(error, "insert code");
    },
    async findNewestActive(email: string, purpose: CodePurpose) {
      const { data, error } = await t()
        .select("*")
        .eq("email", email)
        .eq("purpose", purpose)
        .is("consumed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      check(error, "find code");
      return (data as CodeRow | null) ?? null;
    },
    async bumpAttempts(id: string, expected: number) {
      const { data, error } = await t()
        .update({ attempts: expected + 1 })
        .eq("id", id)
        .eq("attempts", expected)
        .is("consumed_at", null)
        .select("id");
      check(error, "count try");
      return Array.isArray(data) && data.length === 1;
    },
    async consume(id: string, nowIso: string) {
      const { data, error } = await t()
        .update({ consumed_at: nowIso })
        .eq("id", id)
        .is("consumed_at", null)
        .select("id");
      check(error, "use code");
      return Array.isArray(data) && data.length === 1;
    },
    async deleteOlderThan(beforeIso: string) {
      const { error } = await t().delete().lt("created_at", beforeIso);
      check(error, "clean up codes");
    },
  };
}
