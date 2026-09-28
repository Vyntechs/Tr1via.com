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
//   - a code works for 10 minutes and works once; every try (from anyone)
//     counts against it, and after 10 tries it is locked ("burned")
//   - sending a new code does NOT cancel the older ones: every live code for
//     that email + purpose works until it expires, is locked, or one of them
//     signs her in (then the rest are cancelled). So a stranger asking for a
//     code for her email can never cancel the one already in her inbox
//   - per email, per purpose: at most 10 codes an hour — a backstop for her
//     inbox. Burned codes don't count, so after wrong guesses lock a code
//     she can always ask for a fresh one
//   - per email, every purpose together: at most 30 codes an hour, burned
//     ones included (inbox backstop against many networks at once)
//   - a site-wide hourly cap on SIGNUP codes only (a flood of fake sign-ups
//     can't burn through the Zoho mailbox's limits). Login and reset codes
//     have NO site-wide cap: a stranger must never be able to stop a real
//     host getting her code.
//   - the real throttle is per network (IP), in lib/auth/rate-limits.ts,
//     checked by lib/auth/email-code-flow.ts: codes sent per IP per purpose,
//     codes sent from one IP to one email (5 an hour, half the per-email
//     cap), and wrong codes from one IP for one email (5 per 15 minutes,
//     half a code's 10 tries). So one stranger's network can neither use up
//     her code allowance nor lock the code she is typing. A higher cap on
//     wrong codes per email from every network together (20 per 15
//     minutes) is the backstop against guessing from many networks.
//   - the check is constant-time (timingSafeEqual)
//
// Storage lives behind the small CodeStore interface (Supabase in
// lib/auth/email-code-store.ts, an in-memory fake in tests).

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export type CodePurpose = "login" | "reset" | "signup";
export const CODE_PURPOSES: readonly CodePurpose[] = ["login", "reset", "signup"];

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Tries per code, from everyone together; then the code is locked ("burned"). */
export const MAX_ATTEMPTS = 10;
/** Per email + purpose per hour, not counting burned codes. */
export const MAX_SENDS_PER_EMAIL_PER_PURPOSE_PER_HOUR = 10;
/** Per email per hour, every purpose and burned codes included. */
export const MAX_SENDS_PER_EMAIL_PER_HOUR_TOTAL = 30;
// At most this many live codes are checked per guess.
const MAX_LIVE_CODES = 20;
/**
 * Site-wide codes per hour, per purpose. null = no site-wide cap.
 * Only signup is capped (a backstop for the mailbox): signup spam fills only
 * the signup allowance, and existing hosts can ALWAYS get a login or reset
 * code unless their own email or IP is over its limit.
 */
export const MAX_SENDS_PER_HOUR_SITEWIDE: Readonly<Record<CodePurpose, number | null>> = {
  login: null,
  reset: null,
  signup: 20,
};
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
  /**
   * Codes created at/after sinceIso, filtered by email and/or purpose
   * (a null filter means "any"). With attemptsBelow, only codes with fewer
   * tries than that (i.e. not burned).
   */
  countSince(
    filter: { email: string | null; purpose: CodePurpose | null; attemptsBelow?: number },
    sinceIso: string,
  ): Promise<number>;
  /** Mark every unconsumed code for this email + purpose as used. */
  retireActive(email: string, purpose: CodePurpose, nowIso: string): Promise<void>;
  /** Insert and return the new row's id. */
  insert(row: NewCodeRow): Promise<string>;
  /** The newest unconsumed code for this email + purpose, expired or not. */
  findNewestActive(email: string, purpose: CodePurpose): Promise<CodeRow | null>;
  /**
   * Every usable code for this email + purpose: unconsumed, not expired at
   * nowIso, fewer than attemptsBelow tries. Newest first, at most `limit`.
   */
  findLive(
    email: string,
    purpose: CodePurpose,
    nowIso: string,
    attemptsBelow: number,
    limit: number,
  ): Promise<CodeRow[]>;
  /**
   * attempts := expected + 1, only if attempts is still `expected` and the
   * code is unconsumed. False when another request got there first.
   */
  bumpAttempts(id: string, expected: number): Promise<boolean>;
  /** One code's current try count, and whether it's been used. Null if gone. */
  readAttempts(id: string): Promise<{ attempts: number; consumed: boolean } | null>;
  /** consumed_at := now, only if still unconsumed. False if already used. */
  consume(id: string, nowIso: string): Promise<boolean>;
  /** Delete one code (a code whose email never went out). */
  remove(id: string): Promise<void>;
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
  | { ok: true; code: string; codeId: string; expiresAt: string }
  | { ok: false; reason: "too_many_for_email" | "too_many_sitewide" };

export async function issueCode(
  store: CodeStore,
  input: { email: string; purpose: CodePurpose; now?: Date },
): Promise<IssueResult> {
  const email = normalizeEmail(input.email);
  const now = input.now ?? new Date();
  const hourAgo = new Date(now.getTime() - HOUR_MS).toISOString();

  const [unburnedForPurpose, allForEmail] = await Promise.all([
    store.countSince({ email, purpose: input.purpose, attemptsBelow: MAX_ATTEMPTS }, hourAgo),
    store.countSince({ email, purpose: null }, hourAgo),
  ]);
  if (
    unburnedForPurpose >= MAX_SENDS_PER_EMAIL_PER_PURPOSE_PER_HOUR ||
    allForEmail >= MAX_SENDS_PER_EMAIL_PER_HOUR_TOTAL
  ) {
    return { ok: false, reason: "too_many_for_email" };
  }
  const sitewideCap = MAX_SENDS_PER_HOUR_SITEWIDE[input.purpose];
  if (
    sitewideCap !== null &&
    (await store.countSince({ email: null, purpose: input.purpose }, hourAgo)) >= sitewideCap
  ) {
    return { ok: false, reason: "too_many_sitewide" };
  }

  const code = generateCode();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
  // Older codes stay live (see header): no retire here.
  const codeId = await store.insert({
    email,
    purpose: input.purpose,
    code_hash: hashCode({ email, purpose: input.purpose, code }),
    expires_at: expiresAt,
    created_at: nowIso,
  });
  // Best effort; a failed cleanup never blocks a sign-in.
  await store.deleteOlderThan(new Date(now.getTime() - KEEP_ROWS_MS).toISOString()).catch(() => {});
  return { ok: true, code, codeId, expiresAt };
}

export type VerifyResult =
  | { ok: true; codeId: string }
  | {
      ok: false;
      reason: "no_code" | "expired" | "too_many_attempts" | "wrong_code" | "busy";
      /** True when this guess was counted as a try against a code. */
      counted: boolean;
    };

/**
 * Check a code against every live code for this email + purpose. By default
 * a correct code is used up (consumed) right here, and her other live codes
 * are cancelled. With `consume: false` a correct code is only checked (the
 * try still counts), and the caller uses it up with consumeCode() once the
 * thing it guards has actually happened — sign-up and code sign-in do this
 * so a failed account create or session start doesn't waste the code.
 */
export async function verifyCode(
  store: CodeStore,
  input: { email: string; purpose: CodePurpose; code: string; now?: Date; consume?: boolean },
): Promise<VerifyResult> {
  const email = normalizeEmail(input.email);
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const live = await store.findLive(email, input.purpose, nowIso, MAX_ATTEMPTS, MAX_LIVE_CODES);
  if (live.length === 0) {
    // Say why, from the newest code she has.
    const newest = await store.findNewestActive(email, input.purpose);
    if (!newest) return { ok: false, reason: "no_code", counted: false };
    if (new Date(newest.expires_at).getTime() <= now.getTime()) {
      return { ok: false, reason: "expired", counted: false };
    }
    return { ok: false, reason: "too_many_attempts", counted: false };
  }

  // Count this try against EVERY live code BEFORE checking it, each with a
  // compare-and-set, so parallel guesses can never get more than
  // MAX_ATTEMPTS tries at any one code. When a parallel guess moved a
  // code's count first, re-read it and count again (countTry), so losing
  // that race never turns a correct code into "wrong". A guess is only
  // compared against codes it was counted against.
  const tries = await Promise.all(live.map((row) => countTry(store, row)));
  const counted = live.filter((_, i) => tries[i].status === "counted");

  const expected = hashCode({ email, purpose: input.purpose, code: input.code });
  const match = counted.find((row) => hashesMatch(expected, row.code_hash));
  if (!match) {
    // Couldn't count it against some code (heavy contention): say nothing
    // about that code — "try again", never "wrong".
    if (tries.some((t) => t.status === "busy")) {
      return { ok: false, reason: "busy", counted: counted.length > 0 };
    }
    if (counted.length === 0) {
      // Every code was locked or used while this guess was being counted.
      const anyUsed = tries.some((t) => t.status === "used");
      return { ok: false, reason: anyUsed ? "no_code" : "too_many_attempts", counted: false };
    }
    const allLocked = tries.every(
      (t) => t.status === "locked" || t.status === "used" || (t.status === "counted" && t.attempts >= MAX_ATTEMPTS),
    );
    return { ok: false, reason: allLocked ? "too_many_attempts" : "wrong_code", counted: true };
  }
  if (input.consume === false) return { ok: true, codeId: match.id };
  if (!(await consumeCode(store, { codeId: match.id, email, purpose: input.purpose }, now))) {
    return { ok: false, reason: "no_code", counted: true };
  }
  return { ok: true, codeId: match.id };
}

type TryCount =
  | { status: "counted"; attempts: number }
  | { status: "locked" | "used" | "busy" };

/**
 * Count one try against one code: attempts + 1 with a compare-and-set,
 * re-reading the count and trying again when a parallel guess got there
 * first. Every lost race means the count went up (it never goes past
 * MAX_ATTEMPTS) or the code was used, so the loop ends within
 * MAX_ATTEMPTS + 1 rounds; "busy" only if the store misbehaves.
 */
async function countTry(store: CodeStore, row: CodeRow): Promise<TryCount> {
  let attempts = row.attempts;
  for (let round = 0; round <= MAX_ATTEMPTS + 1; round++) {
    if (attempts >= MAX_ATTEMPTS) return { status: "locked" };
    if (await store.bumpAttempts(row.id, attempts)) return { status: "counted", attempts: attempts + 1 };
    const now = await store.readAttempts(row.id);
    if (!now || now.consumed) return { status: "used" };
    attempts = now.attempts;
  }
  return { status: "busy" };
}

/**
 * Use up a code (false if it was already used), then cancel her other live
 * codes for the same purpose — once one signs her in, the rest are done.
 */
export async function consumeCode(
  store: CodeStore,
  input: { codeId: string; email: string; purpose: CodePurpose },
  now: Date = new Date(),
): Promise<boolean> {
  const nowIso = now.toISOString();
  if (!(await store.consume(input.codeId, nowIso))) return false;
  await store.retireActive(normalizeEmail(input.email), input.purpose, nowIso).catch(() => {});
  return true;
}
