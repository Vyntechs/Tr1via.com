// Marks the founder's own account in app_metadata (FOUNDER_KEY) so the
// middleware "Create your password" gate can tell it's her without a hosts
// query on every page load (lib/auth/password-gate.ts).
//
// The mark alone never prompts: the gate also needs this browser's
// "just signed in" cookie (SIGNED_IN_HERE_COOKIE, set by every sign-in
// door), so marking her on one sign-in doesn't pop the prompt on her other
// devices that were already open.
//
// Called when a host with no password signs in by emailed code
// (/api/auth/verify-code) or by the founder's link (/auth/grant) — the only
// doors a no-password account can use. One hosts read at sign-in, and only
// for an account the gate could still ask; nothing on page loads.
//
// Best effort: a failure here never blocks a sign-in.

import "server-only";
import type { User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  FOUNDER_KEY,
  hasPassword,
  isFounderAccount,
  passwordPromptSetting,
} from "@/lib/auth/password-gate";

export async function markFounderIfNeeded(user: Pick<User, "id" | "app_metadata">): Promise<void> {
  const meta = user.app_metadata;
  // The gate only consults the founder mark for an account with no
  // password and no switch set; skip everyone else.
  if (hasPassword(meta) || passwordPromptSetting(meta) !== null || isFounderAccount(meta)) return;
  try {
    const admin = getSupabaseAdmin();
    const { data: host } = await admin
      .from("hosts")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (host?.role !== "founder") return;
    // GoTrue merges app_metadata on an admin update, so send only this key.
    await admin.auth.admin.updateUserById(user.id, { app_metadata: { [FOUNDER_KEY]: true } });
  } catch (err) {
    console.error("[founder-flag] skipped", { message: (err as Error)?.message });
  }
}
