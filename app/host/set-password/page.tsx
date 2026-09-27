// /host/set-password — "Create your password".
//
// Reached from the password gate in middleware.ts (founder's own account,
// or a host whose "Ask to create password" switch is on) and from the
// founder's one-time sign-in link (/auth/grant), and — as "Step 2 of 2" —
// right after a host signs in with an emailed code (?from=code) or uses
// "Forgot password?" (?from=reset). Never shown during a show: the gate
// skips /host/live and /host/phone, and if one of her nights is running
// right now (lib/auth/live-show.ts) this page skips itself — the same
// "Not now" as the link on the form — so she goes straight in and is asked
// again next sign-in. (The save route refuses mid-show too.)
//
// Server wrapper resolves the safe return path and the running-show check;
// the form is client-side. "Not now" goes back to that same safe return
// path (the page the gate interrupted), falling back to /host.

import { redirect } from "next/navigation";
import { passwordLaterHref, setPasswordReturnPath } from "@/lib/auth/password-gate";
import { hostHasRunningShow } from "@/lib/auth/live-show";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServer } from "@/lib/supabase/server";
import { SetPasswordClient } from "./SetPasswordClient";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; from?: string | string[] }>;
}) {
  const { next, from } = await searchParams;
  const raw = Array.isArray(next) ? next[0] : next;
  const rawFrom = Array.isArray(from) ? from[0] : from;
  // How she got here: an emailed code, "Forgot password?", or neither.
  const arrivedVia = rawFrom === "code" || rawFrom === "reset" ? rawFrom : null;
  const returnPath = setPasswordReturnPath(raw ?? null);

  const {
    data: { user },
  } = await (await getSupabaseServer()).auth.getUser();
  // null (couldn't tell) counts as running: never risk a show.
  if (user && (await hostHasRunningShow(getSupabaseAdmin(), user.id)) !== false) {
    redirect(passwordLaterHref(returnPath));
  }

  return <SetPasswordClient returnPath={returnPath} from={arrivedVia} laterHref={passwordLaterHref(returnPath)} />;
}
