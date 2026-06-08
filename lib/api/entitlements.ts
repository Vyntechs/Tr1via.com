// Server-side AI entitlement gate.
//
// One question, asked at every AI boundary: may THIS host run an AI service
// (question generation, answer verification, photo auto-attach) right now?
//
// A host is entitled when ANY of these holds:
//   1. role === 'founder'      — Brandon; never gated.
//   2. is_paywall_bypassed     — comped hosts with lifetime access (e.g. the
//                                founding customer). Checked BEFORE the trial
//                                clock so a comped host is allowed even with no
//                                trial window (trial_ends_at NULL).
//   3. trial_ends_at in future — a self-serve host still inside their 30-day
//                                free trial (stamped at onboarding-complete).
//
// Otherwise — an ended trial, or (defensively) any host with no trial window
// who is neither founder nor comped — AI is denied. Deny-by-default is the
// correct billing posture: we only spend AI/Pexels budget for an entitled host.
//
// Pure + synchronous: the caller already holds the HostRow (requireOwned*
// returns it via select('*')), so this needs no DB round-trip and every branch
// is trivially unit-tested. The single enforcement site is the generation
// route (app/api/categories/[id]/generate) — the one server path into lib/ai.

import type { HostRow } from "@/lib/supabase/types";

export type AIAccess =
  | { allowed: true }
  | { allowed: false; reason: "not_entitled" };

/** Fields the gate reads — a HostRow always satisfies this. */
type Entitlement = Pick<HostRow, "role" | "is_paywall_bypassed" | "trial_ends_at">;

export function hostAIAccess(host: Entitlement, now: Date = new Date()): AIAccess {
  if (host.role === "founder") return { allowed: true };
  if (host.is_paywall_bypassed) return { allowed: true };
  if (host.trial_ends_at && new Date(host.trial_ends_at).getTime() > now.getTime()) {
    return { allowed: true };
  }
  return { allowed: false, reason: "not_entitled" };
}
