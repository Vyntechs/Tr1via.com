// Service-role helpers for reading Supabase auth users.
//
// findAuthUserByEmail — one indexed row via the service-role-only SQL
// function public.find_auth_user_by_email (migration
// 20260928002701_find_auth_user_by_email.sql). The sign-in doors call it on
// unauthenticated requests, so it must not page through every account.
// Until that migration is applied it falls back to the paged walk below.
//
// listAllAuthUsers — the founder's admin list. auth.users isn't selectable
// through PostgREST, so the admin API's listUsers is the documented path.
// It is paged; the old code read one page of 200 and silently missed
// everyone after that. This walks every page instead.

import "server-only";
import type { User } from "@supabase/supabase-js";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type AdminClient = Pick<ReturnType<typeof getSupabaseAdmin>, "auth">;
type LookupClient = Pick<ReturnType<typeof getSupabaseAdmin>, "auth" | "rpc">;

const PER_PAGE = 1000;
// Hard stop so a misbehaving API can never loop forever (1000 × 100 users).
const MAX_PAGES = 100;

/**
 * True when there are no more pages after this one. Prefers the total from
 * the x-total-count header (supabase-js exposes it as data.total) so a server
 * that returns fewer than PER_PAGE per page doesn't end the walk early. We
 * deliberately don't trust data.nextPage: supabase-js parses only the first
 * digit of the page number from the Link header.
 */
function isLastPage(batchLength: number, seen: number, total: unknown): boolean {
  if (batchLength === 0) return true;
  if (typeof total === "number" && total > 0) return seen >= total;
  return batchLength < PER_PAGE;
}

export type AuthUsersResult =
  | { ok: true; users: User[] }
  | { ok: false; error: string };

export async function listAllAuthUsers(admin: AdminClient): Promise<AuthUsersResult> {
  const users: User[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) return { ok: false, error: error.message };
    const batch = data?.users ?? [];
    users.push(...batch);
    if (isLastPage(batch.length, users.length, (data as { total?: unknown } | null)?.total)) break;
  }
  return { ok: true, users };
}

/** The account fields the sign-in doors and admin tools need. */
export interface AuthAccount {
  id: string;
  email: string | undefined;
  app_metadata: Record<string, unknown>;
}

export type FindUserResult =
  | { ok: true; user: AuthAccount | null }
  | { ok: false; error: string };

// PostgREST "function not in schema cache" / Postgres "undefined function":
// the migration isn't applied yet.
function isMissingFunction(err: { code?: string } | null): boolean {
  return err?.code === "PGRST202" || err?.code === "42883";
}

/** Case-insensitive email lookup: one indexed row. */
export async function findAuthUserByEmail(
  admin: LookupClient,
  email: string,
): Promise<FindUserResult> {
  const target = email.trim().toLowerCase();
  const { data, error } = await admin.rpc("find_auth_user_by_email", { p_email: target });
  if (error) {
    if (isMissingFunction(error)) {
      console.warn("[admin-users] find_auth_user_by_email missing; paging listUsers instead");
      return findAuthUserByEmailPaged(admin, target);
    }
    return { ok: false, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { ok: true, user: null };
  const meta = row.raw_app_meta_data;
  return {
    ok: true,
    user: {
      id: row.id,
      email: row.email ?? undefined,
      app_metadata:
        meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {},
    },
  };
}

/** Fallback only (see header): walks every page, stops at the first hit. */
export async function findAuthUserByEmailPaged(
  admin: AdminClient,
  email: string,
): Promise<FindUserResult> {
  const target = email.trim().toLowerCase();
  let seen = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) return { ok: false, error: error.message };
    const batch = data?.users ?? [];
    const hit = batch.find((u) => u.email?.toLowerCase() === target);
    if (hit) {
      return { ok: true, user: { id: hit.id, email: hit.email, app_metadata: hit.app_metadata ?? {} } };
    }
    seen += batch.length;
    if (isLastPage(batch.length, seen, (data as { total?: unknown } | null)?.total)) break;
  }
  return { ok: true, user: null };
}
