// One-time 6-digit email codes for host sign-in, built in-house.
//
// Used for three things (the "purpose"):
//   login  — an account with no password yet signs in, then creates one
//   reset  — "Forgot password?": sign in, then choose a new password
//   signup — prove a brand-new host owns the email before the account exists
//
// Rules (all enforced here, on the server):
//   - codes are random (crypto.randomInt), 6 digits
//   - only an HMAC-SHA256 of purpose + email + code is stored, keyed by the
//     server's SESSION_SECRET — never the plain code
//   - a code works for 10 minutes, allows 5 tries, and works once
//   - sending a new code retires the older ones for that email + purpose
//   - at most 5 codes per email per hour, and a site-wide hourly cap so a
//     flood of fake sign-ups can't burn through the Zoho mailbox's limits
//   - the check is constant-time (timingSafeEqual)
//
// Storage lives behind the small CodeStore interface (Supabase in
// lib/auth/email-code-store.ts, an in-memory fake in tests).

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export type CodePurpose = "login" | "reset" | "signup";
export const CODE_PURPOSES: readonly CodePurpose[] = ["login", "reset", "signup"];

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const MAX_SENDS_PER_EMAIL_PER_HOUR = 5;
export const MAX_SENDS_PER_HOUR_SITEWIDE = 60;
const HOUR_MS = 60 * 60 * 1000;
// Rows older than this are deleted opportunistically when a new code is sent.
const KEEP_ROWS_MS = 24 * HOUR_MS;

export interface CodeRow {
  id: string;
  email: string;
  code_hash: string;
  purpose: CodePurpose;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
  created_at: string;
}

export interface NewCodeRow {
  email: string;
  code_hash: string;
  purpose: CodePurpose;
  expires_at: string;
  created_at: string;
}

export interface CodeStore {
  /** Codes created at/after sinceIso — for one email, or site-wide when email is null. */
  countSince(email: string | null, sinceIso: string): Promise<number>;
  /** Mark every unconsumed code for this email + purpose as used. */
  retireActive(email: string, purpose: CodePurpose, nowIso: string): Promise<void>;
  insert(row: NewCodeRow): Promise<void>;
  /** The newest unconsumed code for this email + purpose, expired or not. */
  findNewestActive(email: string, purpose: CodePurpose): Promise<CodeRow | null>;
  /**
   * attempts := expected + 1, only if attempts is still `expected` and the
   * code is unconsumed. False when another request got there first.
   */
  bumpAttempts(id: string, expected: number): Promise<boolean>;
  /** consumed_at := now, only if still unconsumed. False if already used. */
  consume(id: string, nowIso: string): Promise<boolean>;
  /** Housekeeping: delete rows created before beforeIso. */
  deleteOlderThan(beforeIso: string): Promise<void>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isCodePurpose(v: unknown): v is CodePurpose {
  return typeof v === "string" && (CODE_PURPOSES as readonly string[]).includes(v);
}

export function generateCode(): string {
  return randomInt(0, 10 ** CODE_LENGTH).toString().padStart(CODE_LENGTH, "0");
}

/** Only digits, exactly 6 of them (spaces/dashes a host might paste are dropped). */
export function cleanCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

function codeSecret(): string {
  const secret = process.env.SESSION_SECRET;
  // Fail closed: without the server secret we refuse to make or check codes.
  if (!secret) throw new CodeConfigError("SESSION_SECRET is not set");
  return secret;
}

export class CodeConfigError extends Error {}

export function hashCode(
  input: { email: string; purpose: CodePurpose; code: string },
  secret: string = codeSecret(),
): string {
  return createHmac("sha256", secret)
    .update(`tr1via-email-code:v1:${input.purpose}:${normalizeEmail(input.email)}:${input.code}`)
    .digest("hex");
}

/** Constant-time compare of two hex digests. */
export function hashesMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** h***@example.com — enough for a host to recognize her own address. */
export function maskEmail(email: string): string {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf("@");
  if (at < 1) return "***";
  return `${e[0]}***${e.slice(at)}`;
}

export type IssueResult =
  | { ok: true; code: string; expiresAt: string }
  | { ok: false; reason: "too_many_for_email" | "too_many_sitewide" };

export async function issueCode(
  store: CodeStore,
  input: { email: string; purpose: CodePurpose; now?: Date },
): Promise<IssueResult> {
  const email = normalizeEmail(input.email);
  const now = input.now ?? new Date();
  const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();

  if ((await store.countSince(email, hourAgo)) >= MAX_SENDS_PER_EMAIL_PER_HOUR) {
    return { ok: false, reason: "too_many_for_email" };
  }
  if ((await store.countSince(null, hourAgo)) >= MAX_SENDS_PER_HOUR_SITEWIDE) {
    return { ok: false, reason: "too_many_sitewide" };
  }

  const code = generateCode();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  await store.retireActive(email, input.purpose, nowIso);
  await store.insert({
    email,
    purpose: input.purpose,
    code_hash: hashCode({ email, purpose: input.purpose, code }),
    expires_at: expiresAt,
    created_at: nowIso,
  });
  // Best effort; a failed cleanup never blocks a sign-in.
  await store.deleteOlderThan(new Date(now.getTime() - KEEP_ROWS_MS).toISOString()).catch(() => {});
  return { ok: true, code, expiresAt };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "no_code" | "expired" | "too_many_attempts" | "wrong_code" | "busy" };

export async function verifyCode(
  store: CodeStore,
  input: { email: string; purpose: CodePurpose; code: string; now?: Date },
): Promise<VerifyResult> {
  const email = normalizeEmail(input.email);
  const now = input.now ?? new Date();
  const row = await store.findNewestActive(email, input.purpose);
  if (!row) return { ok: false, reason: "no_code" };
  if (new Date(row.expires_at).getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "too_many_attempts" };

  // Count this try BEFORE checking it, with a compare-and-set so parallel
  // guesses can never get more than MAX_ATTEMPTS tries between them.
  if (!(await store.bumpAttempts(row.id, row.attempts))) return { ok: false, reason: "busy" };

  const expected = hashCode({ email, purpose: input.purpose, code: input.code });
  if (!hashesMatch(expected, row.code_hash)) {
    return {
      ok: false,
      reason: row.attempts + 1 >= MAX_ATTEMPTS ? "too_many_attempts" : "wrong_code",
    };
  }
  if (!(await store.consume(row.id, now.toISOString()))) return { ok: false, reason: "no_code" };
  return { ok: true };
}
