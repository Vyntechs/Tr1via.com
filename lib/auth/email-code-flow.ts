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
  issueCode,
  maskEmail,
  verifyCode,
  type CodePurpose,
  type CodeStore,
} from "@/lib/auth/email-codes";
import { sendCodeEmail, smtpConfigFromEnv } from "@/lib/email/send-code-email";
import {
  CODE_EXPIRED_MESSAGE,
  CODE_LOCKED_MESSAGE,
  CODE_NOT_SENT_MESSAGE,
  CODE_USED_MESSAGE,
  TOO_MANY_CODES_MESSAGE,
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

export async function sendCodeTo(
  email: string,
  purpose: CodePurpose,
  storeArg?: CodeStore,
): Promise<SendOutcome> {
  const maskedEmail = maskEmail(email);
  // Don't use up one of the host's hourly codes if mail can't go out.
  if (!smtpConfigFromEnv()) {
    return { ok: false, status: 503, code: "code_not_sent", error: CODE_NOT_SENT_MESSAGE, maskedEmail };
  }
  let issued;
  let store: CodeStore;
  try {
    store = storeArg ?? supabaseCodeStore();
    issued = await issueCode(store, { email, purpose });
  } catch (err) {
    console.error("[email-code] could not save code", { purpose, message: (err as Error)?.message });
    return { ok: false, status: 503, code: "code_not_sent", error: CODE_NOT_SENT_MESSAGE, maskedEmail };
  }
  if (!issued.ok) {
    return { ok: false, status: 429, code: "too_many_codes", error: TOO_MANY_CODES_MESSAGE, maskedEmail };
  }
  const sent = await sendCodeEmail(email, issued.code);
  if (!sent.ok) {
    // A code nobody received shouldn't stay usable.
    await store.retireActive(email, purpose, new Date().toISOString()).catch(() => {});
    return { ok: false, status: 503, code: "code_not_sent", error: CODE_NOT_SENT_MESSAGE, maskedEmail };
  }
  return { ok: true, maskedEmail };
}

export type CheckOutcome = { ok: true } | FlowFailure;

export async function checkCode(
  email: string,
  purpose: CodePurpose,
  code: string,
  storeArg?: CodeStore,
): Promise<CheckOutcome> {
  let result;
  try {
    result = await verifyCode(storeArg ?? supabaseCodeStore(), { email, purpose, code });
  } catch (err) {
    console.error("[email-code] could not check code", { purpose, message: (err as Error)?.message });
    return { ok: false, status: 500, code: "try_again", error: TRY_AGAIN_MESSAGE };
  }
  if (result.ok) return { ok: true };
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
 * Sign in a host whose email we've just verified. Same server-side path as
 * /auth/grant: the admin API mints a one-time magic-link token (no email is
 * sent), and verifyOtp exchanges it for session cookies held on
 * `applyCookies` until the route picks its response.
 */
export async function startSessionForEmail(
  req: NextRequest,
  email: string,
): Promise<
  | { ok: true; user: User; applyCookies: ReturnType<typeof createSessionCookieClient>["applyCookies"] }
  | { ok: false }
> {
  const { data: link, error: linkErr } = await getSupabaseAdmin().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return { ok: false };
  const { supabase, applyCookies } = createSessionCookieClient(req);
  const { data, error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (error || !data.user) return { ok: false };
  return { ok: true, user: data.user, applyCookies };
}
