// Service-role Supabase client. RLS bypassed. ONLY use server-side for
// trusted operations:
//   - resolving a question at T+20 (computes is_correct + awarded_points
//     for all answers in one transaction)
//   - creating a player on behalf of a device that hasn't authed yet
//   - housekeeping (closing nights, etc.)
//
// NEVER import this from a Client Component or expose it to the browser.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name} — copy .env.example to .env.local`);
  return v;
}

let _admin: ReturnType<typeof createClient<Database>> | undefined;

export function getSupabaseAdmin() {
  if (!_admin) {
    _admin = createClient<Database>(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return _admin;
}
