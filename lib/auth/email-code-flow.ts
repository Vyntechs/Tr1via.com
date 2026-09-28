// Server glue for the emailed 6-digit codes: make + email a code, check a
// code, and start a session for a verified email. Used by
// /api/auth/start, /api/auth/send-code, /api/auth/verify-code and
// /api/auth/host-access. Every result carries a plain-English message.

import "server-only";
import type { NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSessionCookieClient } from "@/lib/auth/session-cookies";
import { supabaseCodeStore } from "@/lib/auth/email-code-store";
import {
  consumeCode,
  issueCode,
  maskEmail,
  verifyCode,
  type CodePurpose,
  type CodeStore,
} from "@/lib/auth/email-codes";
import { claimEvent, forgetEvent, ipEmailKey, isOverLimit, recordEvent, type RateStore } from "@/lib/auth/rate-limits";
import { sendCodeEmail, smtpConfigFromEnv } from "@/lib/email/send-code-email";
import {
  CODE_EXPIRED_MESSAGE,
  CODE_LOCKED_MESSAGE,
  CODE_NOT_SENT_MESSAGE,
  CODE_USED_MESSAGE,
  CODES_PAUSED_MESSAGE,
  TOO_MANY_CODES_MESSAGE,
  TOO_MANY_WRONG_CODES_MESSAGE,
  TRY_AGAIN_MESSAGE,
  WRONG_CODE_MESSAGE,
} from "@/lib/auth/auth-messages";

const EmailSchema = z.string().trim().toLowerCase().email().max(254);

/** Lower-cased, trimmed email, or null when it isn't a real address. */
export function parseEmail(v: unknown): string | null {
  const parsed = EmailSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}

export interface FlowFailure {
  ok: false;
  status: number;
  code: string;
  error: string;
}

export type SendOutcome = { ok: true; maskedEmail: string } | (FlowFailure & { maskedEmail: string });

/**
 * Failure codes:
 *   too_many_codes — this email already got its hourly codes (from this
 *                    network, or from everyone). She has recent codes that
 *                    still work, so /api/auth/start and the login page move
 *                    her to the code screen anyway.
 *   codes_paused   — NO code was sent (this IP's hourly code limit, or the
 *                    site-wide signup cap). The page stays on the email box
 *                    with "We couldn't send a code right now. Text Brandon…".
 *   code_not_sent  — mail or database trouble.
 */
export async function sendCodeTo(
  email: string,
  purpose: CodePurpose,
  ip: string,
  opts: { store?: CodeStore; rates?: RateStore } = {},
): Promise<SendOutcome> {
  const maskedEmail = maskEmail(email);
  const paused = (status: number): SendOutcome => ({
    ok: false,
    status,
    code: "codes_paused",
    error: CODES_PAUSED_MESSAGE,
    maskedEmail,
  });
  // Don't use up one of the host's hourly codes if mail can't go out.
  if (!smtpConfigFromEnv()) {
    return { ok: false, status: 503, code: "code_not_sent", error: CODE_NOT_SENT_MESSAGE, maskedEmail };
  }
  // Per-IP, per-purpose hourly cap (lib/auth/rate-limits.ts; fails open).
  const ipBucket = `ip:code-${purpose}` as const;
  if (await isOverLimit(ipBucket, ip, { store: opts.rates })) return paused(429);
  // Codes from this network to this email (every purpose): half the
  // per-email cap, so one stranger can't use up her codes for the hour.
  const pairKey = ipEmailKey(ip, email);
  if (await isOverLimit("send:code-ip-email", pairKey, { store: opts.rates })) {
    return { ok: false, status: 429, code: "too_many_codes", error: TOO_MANY_CODES_MESSAGE, maskedEmail };
  }
  let issued;
  let store: CodeStore;
  try {
    store = opts.store ?? supabaseCodeStore();
    issued = await issueCode(store, { email, purpose });
  } catch (err) {
    console.error("[email-code] could not save code", { purpose, message: (err as Error)?.message });
    return { ok: false, status: 503, code: "code_not_sent", error: CODE_NOT_SENT_MESSAGE, maskedEmail };
  }
  if (!issued.ok) {
    if (issued.reason === "too_many_sitewide") return paused(503);
    return { ok: false, status: 429, code: "too_many_codes", error: TOO_MANY_CODES_MESSAGE, maskedEmail };
  }
  // Counted before sending (mail can take seconds; that shouldn't widen the
  // gap between the cap check above and this count), taken back below on
  // failure.
  const ipEvent = await recordEvent(ipBucket, ip, { store: opts.rates });
  const pairEvent = await recordEvent("send:code-ip-email", pairKey, { store: opts.rates });
  const sent = await sendCodeEmail(email, issued.code);
  if (!sent.ok) {
    // A code that never went out doesn't count against her: delete it (so
    // it leaves her hourly counts in issueCode) and take back the two send
    // counts. Her earlier codes still work. If the delete fails, at least
    // make it unusable.
    await store.remove(issued.codeId).catch(() =>
      store.consume(issued.codeId, new Date().toISOString()).catch(() => {}),
    );
    await forgetEvent(ipEvent, { store: opts.rates });
    await forgetEvent(pairEvent, { store: opts.rates });
    return { ok: false, status: 503, code: "code_not_sent", error: CODE_NOT_SENT_MESSAGE, maskedEmail };
  }
  return { ok: true, maskedEmail };
}

export type CheckOutcome = { ok: true; codeId: string } | FlowFailure;

/**
 * Check a code. `consume: false` only checks it (see verifyCode); use it up
 * afterwards with spendCode(). `ip` is the visitor's network: wrong codes
 * from one network for one email are capped (lib/auth/rate-limits.ts), so
 * a stranger can't lock the code she is typing; wrong codes for one email
 * from every network together have a higher backstop cap.
 */
export async function checkCode(
  email: string,
  purpose: CodePurpose,
  code: string,
  opts: { ip: string; store?: CodeStore; rates?: RateStore; consume?: boolean },
): Promise<CheckOutcome> {
  const pairKey = ipEmailKey(opts.ip, email);
  const rates = { store: opts.rates };
  const tooMany = { ok: false, status: 429, code: "too_many_wrong_codes", error: TOO_MANY_WRONG_CODES_MESSAGE } as const;
  // Count this guess as wrong BEFORE checking it — this network's wrong
  // codes for her email, then everyone's together (the many-network
  // backstop) — so guesses fired at the same moment can't all slip past
  // the caps (claimEvent). Taken back below when it wasn't a counted wrong
  // guess.
  const pair = await claimEvent("fail:code-ip-email", pairKey, rates);
  if (pair.over) return tooMany;
  const all = await claimEvent("fail:code-email", email, rates);
  if (all.over) {
    await forgetEvent(pair.id, rates);
    return tooMany;
  }
  const takeBack = async () => {
    await forgetEvent(pair.id, rates);
    await forgetEvent(all.id, rates);
  };
  let result;
  try {
    result = await verifyCode(opts.store ?? supabaseCodeStore(), {
      email,
      purpose,
      code,
      consume: opts.consume,
    });
  } catch (err) {
    console.error("[email-code] could not check code", { purpose, message: (err as Error)?.message });
    await takeBack();
    return { ok: false, status: 500, code: "try_again", error: TRY_AGAIN_MESSAGE };
  }
  // Only a wrong guess that was counted against a code stays counted.
  if (result.ok || !result.counted) await takeBack();
  if (result.ok) return { ok: true, codeId: result.codeId };
  switch (result.reason) {
    case "wrong_code":
      return { ok: false, status: 400, code: "wrong_code", error: WRONG_CODE_MESSAGE };
    case "expired":
      return { ok: false, status: 400, code: "code_expired", error: CODE_EXPIRED_MESSAGE };
    case "too_many_attempts":
      return { ok: false, status: 429, code: "code_locked", error: CODE_LOCKED_MESSAGE };
    case "no_code":
      return { ok: false, status: 400, code: "code_used", error: CODE_USED_MESSAGE };
    default:
      return { ok: false, status: 409, code: "try_again", error: TRY_AGAIN_MESSAGE };
  }
}

/**
 * Use up a code checked with `consume: false`, and cancel her other live
 * codes for that purpose. "already_used" = a parallel request used it
 * first; "error" = the database couldn't be reached (the code still works,
 * so a retry with the same code is safe).
 */
export async function spendCode(
  input: { codeId: string; email: string; purpose: CodePurpose },
  storeArg?: CodeStore,
): Promise<"used" | "already_used" | "error"> {
  try {
    return (await consumeCode(storeArg ?? supabaseCodeStore(), input)) ? "used" : "already_used";
  } catch (err) {
    console.error("[email-code] could not mark code used", { message: (err as Error)?.message });
    return "error";
  }
}

/**
 * Sign in a host whose email we've just verified. Same server-side path as
 * /auth/grant: the admin API mints a one-time magic-link token (no email is
 * sent), and verifyOtp exchanges it for session cookies held on
 * `applyCookies` until the route picks its response.
 *
 * `endSession()` revokes just this new session (scope "local": her other
 * devices stay signed in) — for when the route decides not to hand it out
 * after all, so it isn't left alive on the server with no cookies anywhere.
 */
export async function startSessionForEmail(
  req: NextRequest,
  email: string,
): Promise<
  | {
      ok: true;
      user: User;
      applyCookies: ReturnType<typeof createSessionCookieClient>["applyCookies"];
      endSession: () => Promise<void>;
    }
  | { ok: false }
> {
  const admin = getSupabaseAdmin();
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return { ok: false };
  const { supabase, applyCookies } = createSessionCookieClient(req);
  const { data, error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error || !data.user) return { ok: false };
  const accessToken = data.session?.access_token;
  const endSession = async () => {
    if (!accessToken) return;
    try {
      const { error: outErr } = await admin.auth.admin.signOut(accessToken, "local");
      if (outErr) throw outErr;
    } catch (err) {
      // Best effort: the session got no cookies, so nobody holds it.
      console.error("[email-code] could not end the unused session", { message: (err as Error)?.message });
    }
  };
  return { ok: true, user: data.user, applyCookies, endSession };
}
