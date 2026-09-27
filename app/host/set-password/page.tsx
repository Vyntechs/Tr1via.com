// /host/set-password — "Create your password".
//
// Reached from the password gate in middleware.ts (founder's own account,
// or a host whose "Ask to create password" switch is on) and from the
// founder's one-time sign-in link (/auth/grant). Never shown during a show:
// the gate skips /host/live and /host/phone.
//
// Server wrapper only resolves the safe return path; the form is client-side.

import { setPasswordReturnPath } from "@/lib/auth/password-gate";
import { SetPasswordClient } from "./SetPasswordClient";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const raw = Array.isArray(next) ? next[0] : next;
  return <SetPasswordClient returnPath={setPasswordReturnPath(raw ?? null)} />;
}
