// Service-role Supabase client for LOCAL e2e specs that need to shape an
// auth account the way production has it (e.g. an account made before
// passwords existed). Reads the same .env.local the dev server uses.
//
// Refuses to run against anything but a local Supabase (127.0.0.1 /
// localhost) so a spec can never touch a real project's users.

import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

export function localAdminOrNull(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function getAuthUser(admin: SupabaseClient, userId: string): Promise<User> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) throw new Error(`getUserById failed: ${error?.message}`);
  return data.user;
}

/**
 * Make an account look like one created before passwords existed: no
 * app_metadata.password_set_at and no founder password_prompt switch.
 * (/api/_test/login always stamps password_set_at; this removes it.)
 */
export async function makeLegacyAccount(admin: SupabaseClient, userId: string): Promise<User> {
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { password_set_at: null, password_prompt: null },
  });
  if (error) throw new Error(`strip password marker failed: ${error.message}`);
  return getAuthUser(admin, userId);
}
