// /host/set-password — "Create your password".
//
// Reached from the password gate in middleware.ts (founder's own account,
// or a host whose "Ask to create password" switch is on) and from the
// founder's one-time sign-in link (/auth/grant), and — as "Step 2 of 2" —
// right after a host signs in with an emailed code (?from=code) or uses
// "Forgot password?" (?from=reset). Never shown during a show:
// the gate skips /host/live and /host/phone.
//
// Server wrapper only resolves the safe return path; the form is client-side.

import { setPasswordReturnPath } from "@/lib/auth/password-gate";
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
  return <SetPasswordClient returnPath={setPasswordReturnPath(raw ?? null)} from={arrivedVia} />;
}
