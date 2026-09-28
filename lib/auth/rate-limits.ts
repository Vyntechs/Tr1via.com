// Abuse limits for the host sign-in doors, on top of the per-code limits in
// lib/auth/email-codes.ts.
//
//   Per IP, every request (15-minute window):
//     /api/auth/start        20   (looks up an email; may send a code)
//     /api/auth/send-code    10   (each one emails a code)
//     /api/auth/verify-code  20   (and /api/auth/host-access — code checks)
//     /api/auth/login        30
//   Wrong passwords at /api/auth/login (15-minute window):
//     per IP + email         10   → "Too many tries. Wait 15 minutes or use
//     per IP                 20      Forgot password."
//     per email              50   (every network together: a backstop
//                                   against guessing from many networks.
//                                   The tight lockout is keyed by network +
//                                   email, so a stranger typing her email
//                                   on their own network can't lock her out;
//                                   only a many-network attack reaches 50)
//   "Forgot password?" (send-code "reset") is NOT blocked by the password
//   lockout, so a host who is locked out can always get back in by code.
//   Saving a new password lifts her lockouts on every network: the email
//   backstop is cleared, and wrong passwords from before her newest
//   password (app_metadata.password_set_at) stop counting toward the
//   network + email lock (app/api/auth/login/route.ts).
//   Codes actually sent, per IP per purpose (1-hour window) — this is what
//   protects the Zoho mailbox:
//     login                  10   (whichever door sends it: start or send-code)
//     reset                  10
//     signup                  3   (well below the site-wide signup cap of 20
//                                   in lib/auth/email-codes.ts, so one IP
//                                   can't use it up; login/reset have no
//                                   site-wide cap at all)
//   Codes sent from one IP to one email (1-hour window, every purpose):
//                           5    half the per-email cap in email-codes.ts,
//                                 so one stranger's network can't use up
//                                 her codes for the hour
//   Wrong codes from one IP for one email (15-minute window):
//                           5    half of a code's 10 tries, so one
//                                 stranger's network can't lock the code
//                                 she is typing (a code lives 10 minutes)
//   Wrong codes for one email, every network together (15-minute window):
//                          20    a backstop against guessing her codes
//                                 from many networks at once (without it,
//                                 30 codes an hour x 10 tries each = 300
//                                 guesses an hour). Trade-off: a
//                                 many-network attack can pause her codes
//                                 for up to 15 minutes ("Text Brandon if
//                                 you're stuck"). Her own typos are a
//                                 handful, nowhere near 20.
//   Only codes that really went out are counted: the two send counts are
//   recorded before the email goes out (so a burst can't all slip past the
//   cap while mail is slow) and taken back if the send fails
//   (lib/auth/email-code-flow.ts).
//   The two wrong-code caps count every guess BEFORE checking it
//   (claimEvent) and take it back if the guess turns out right, so guesses
//   fired at the same moment from one network can't slip past its cap of
//   5 — reaching the every-network 20 really takes several networks.
//
// Events live in public.auth_rate_events (lib/auth/rate-limit-store.ts).
// Keys are HMAC'd with SESSION_SECRET, so no plain IP or email is stored.
//
// FAIL OPEN: if the table is missing (code shipped before the migration) or
// the database hiccups, the limit is skipped and the host signs in as normal.
// A limit that can lock Heather out on a Wednesday is worse than none.

import "server-only";
import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { supabaseRateStore } from "@/lib/auth/rate-limit-store";

export const RATE_WINDOW_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type RateBucket =
  | "ip:start"
  | "ip:send-code"
  | "ip:verify-code"
  | "ip:login"
  | "fail:login-ip-email"
  | "fail:login-email"
  | "fail:login-ip"
  | "ip:code-login"
  | "ip:code-reset"
  | "ip:code-signup"
  | "send:code-ip-email"
  | "fail:code-ip-email"
  | "fail:code-email";

export const RATE_LIMITS: Readonly<Record<RateBucket, number>> = {
  "ip:start": 20,
  "ip:send-code": 10,
  "ip:verify-code": 20,
  "ip:login": 30,
  "fail:login-ip-email": 10,
  "fail:login-email": 50,
  "fail:login-ip": 20,
  "ip:code-login": 10,
  "ip:code-reset": 10,
  "ip:code-signup": 3,
  "send:code-ip-email": 5,
  "fail:code-ip-email": 5,
  "fail:code-email": 20,
};

/** How far back each bucket counts. Everything not listed: RATE_WINDOW_MS. */
export const RATE_WINDOWS_MS: Readonly<Partial<Record<RateBucket, number>>> = {
  "ip:code-login": HOUR_MS,
  "ip:code-reset": HOUR_MS,
  "ip:code-signup": HOUR_MS,
  "send:code-ip-email": HOUR_MS,
};

export function rateWindowMs(bucket: RateBucket): number {
  return RATE_WINDOWS_MS[bucket] ?? RATE_WINDOW_MS;
}

// Rows older than this are deleted as we go.
const KEEP_MS = 24 * 60 * 60 * 1000;

export interface RateStore {
  /** Events for this bucket + hashed key created at/after sinceIso. */
  count(bucket: RateBucket, keyHash: string, sinceIso: string): Promise<number>;
  /** Save one event and return its id (for forget). */
  record(bucket: RateBucket, keyHash: string, nowIso: string): Promise<string>;
  /** Forget every event for this bucket + hashed key (e.g. after a new password). */
  clear(bucket: RateBucket, keyHash: string): Promise<void>;
  /** Forget one event by the id record() returned. */
  forget(id: string): Promise<void>;
  deleteOlderThan(beforeIso: string): Promise<void>;
}

/**
 * The visitor's IP. On Vercel, x-real-ip and x-forwarded-for are set by the
 * edge to the real client IP (a client can't spoof them there). Locally
 * they may be missing; everyone then shares one "unknown" key.
 */
export function clientIp(req: Pick<NextRequest, "headers">): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const first = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || "unknown";
}

export function rateKeyHash(bucket: RateBucket, key: string, secret = process.env.SESSION_SECRET): string {
  // SESSION_SECRET is always set in real deployments; the fallback only
  // keeps limits working (keys still hashed) if it ever isn't.
  return createHmac("sha256", secret || "tr1via-rate-limit")
    .update(`tr1via-rate:v1:${bucket}:${key.trim().toLowerCase()}`)
    .digest("hex");
}

function storeOrNull(store?: RateStore): RateStore | null {
  if (store) return store;
  try {
    return supabaseRateStore();
  } catch {
    return null;
  }
}

function logSkip(what: string, err: unknown) {
  console.error("[rate-limit] skipped (failing open)", { what, message: (err as Error)?.message });
}

/**
 * True when this bucket + key already has `limit` events in the window.
 * `notBefore`: ignore events before this moment too (e.g. her last new
 * password — a lock keyed by network can't be cleared for every network
 * at once, so events from before the reset just stop counting).
 */
export async function isOverLimit(
  bucket: RateBucket,
  key: string,
  opts: { store?: RateStore; now?: Date; notBefore?: string | null } = {},
): Promise<boolean> {
  const store = storeOrNull(opts.store);
  if (!store) return false;
  const now = opts.now ?? new Date();
  try {
    let sinceMs = now.getTime() - rateWindowMs(bucket);
    const floor = opts.notBefore ? new Date(opts.notBefore).getTime() : NaN;
    if (Number.isFinite(floor) && floor > sinceMs) sinceMs = floor;
    const since = new Date(sinceMs).toISOString();
    return (await store.count(bucket, rateKeyHash(bucket, key), since)) >= RATE_LIMITS[bucket];
  } catch (err) {
    logSkip(`count ${bucket}`, err);
    return false;
  }
}

/**
 * Count one event (best effort — never throws). Returns the event's id
 * (for forgetEvent), or null if it couldn't be saved.
 */
export async function recordEvent(
  bucket: RateBucket,
  key: string,
  opts: { store?: RateStore; now?: Date } = {},
): Promise<string | null> {
  const store = storeOrNull(opts.store);
  if (!store) return null;
  const now = opts.now ?? new Date();
  let id: string;
  try {
    id = await store.record(bucket, rateKeyHash(bucket, key), now.toISOString());
  } catch (err) {
    logSkip(`record ${bucket}`, err);
    return null;
  }
  // Light housekeeping: roughly one request in 20 sweeps old rows. Its
  // failure never loses the event just saved.
  if (Math.random() < 0.05) {
    await store.deleteOlderThan(new Date(now.getTime() - KEEP_MS).toISOString()).catch((err) => {
      logSkip(`clean up ${bucket}`, err);
    });
  }
  return id;
}

/** Take back one event by the id recordEvent returned (best effort; null does nothing). */
export async function forgetEvent(id: string | null, opts: { store?: RateStore } = {}): Promise<void> {
  if (!id) return;
  const store = storeOrNull(opts.store);
  if (!store) return;
  try {
    await store.forget(id);
  } catch (err) {
    logSkip("forget", err);
  }
}

/**
 * Count first, then check: saves this event, then refuses (and takes it
 * back) if that puts the bucket over its limit. Unlike isOverLimit +
 * recordEvent, requests fired at the same moment can't all see a count
 * under the limit, so a burst can't slip past it. Fails open (never
 * refuses) when the store can't be reached. `id` is for forgetEvent when
 * the thing it counted turns out not to count (e.g. a right code).
 */
export async function claimEvent(
  bucket: RateBucket,
  key: string,
  opts: { store?: RateStore; now?: Date } = {},
): Promise<{ over: boolean; id: string | null }> {
  const store = storeOrNull(opts.store);
  if (!store) return { over: false, id: null };
  const now = opts.now ?? new Date();
  const id = await recordEvent(bucket, key, { ...opts, store, now });
  if (!id) return { over: false, id: null };
  try {
    const since = new Date(now.getTime() - rateWindowMs(bucket)).toISOString();
    // This count includes the event just saved.
    if ((await store.count(bucket, rateKeyHash(bucket, key), since)) > RATE_LIMITS[bucket]) {
      await forgetEvent(id, { store });
      return { over: true, id: null };
    }
  } catch (err) {
    logSkip(`count ${bucket}`, err);
  }
  return { over: false, id };
}

export async function clearEvents(
  bucket: RateBucket,
  key: string,
  opts: { store?: RateStore } = {},
): Promise<void> {
  const store = storeOrNull(opts.store);
  if (!store) return;
  try {
    await store.clear(bucket, rateKeyHash(bucket, key));
  } catch (err) {
    logSkip(`clear ${bucket}`, err);
  }
}

/** Key for the IP + email buckets ("send:code-ip-email", "fail:code-ip-email", "fail:login-ip-email"). */
export function ipEmailKey(ip: string, email: string): string {
  return `${ip}|${email.trim().toLowerCase()}`;
}

/**
 * The per-IP request limit for one door: refuse when over, otherwise count
 * this request. Returns true when the request should be refused.
 */
export async function hitIpLimit(
  bucket: Extract<RateBucket, `ip:${string}`>,
  req: Pick<NextRequest, "headers">,
  opts: { store?: RateStore; now?: Date } = {},
): Promise<boolean> {
  const ip = clientIp(req);
  if (await isOverLimit(bucket, ip, opts)) return true;
  await recordEvent(bucket, ip, opts);
  return false;
}
