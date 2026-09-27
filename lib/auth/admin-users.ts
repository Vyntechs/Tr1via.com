// Service-role helpers for reading Supabase auth users without a cap.
//
// auth.users isn't selectable through PostgREST, so the admin API's
// listUsers is the documented path. It is paged; the old code read one
// page of 200 and silently missed everyone after that. These helpers walk
// every page instead.

import "server-only";
import type { User } from "@supabase/supabase-js";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type AdminClient = Pick<ReturnType<typeof getSupabaseAdmin>, "auth">;

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

export type FindUserResult =
  | { ok: true; user: User | null }
  | { ok: false; error: string };

/** Case-insensitive email match across every page. Stops at the first hit. */
export async function findAuthUserByEmail(
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
    if (hit) return { ok: true, user: hit };
    seen += batch.length;
    if (isLastPage(batch.length, seen, (data as { total?: unknown } | null)?.total)) break;
  }
  return { ok: true, user: null };
}
