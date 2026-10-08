// The venue TV's pass for the diagnostic log.
//
// The TV has no login and no cookie, so without something extra anyone who
// knows a room code could send "TV reports" for that night. Instead the server
// gives the TV PAGE a signed pass when the page loads (app/tv/[code]/layout.tsx),
// and the TV sends it with every report. The pass:
//
//   - names ONE night (the night is read from the pass, never from the report)
//   - stops working after DIAG_TV_PASS_TTL_MS (8 hours)
//   - is signed with a key of its own, derived from SESSION_SECRET (the same
//     server secret that signs device cookies) under a fixed label. The pass
//     signature is therefore NOT a valid device-cookie signature for any id,
//     and a device-cookie signature is not a valid pass signature
//   - is only issued while logging is on, for a room code that exists
//
// It is not a login: the TV page itself is public by design, so anyone who
// opens it gets a pass. What the pass buys is that a report can no longer be
// invented for a night without first loading that night's TV page, every pass
// dies on its own, and everything a pass can send is still rebuilt from the
// fixed field lists (ingest.ts) and held to the night's row caps (write.ts).
//
// Format: v1.<night id>.<expiry, seconds, base 36>.<signature, base64url>

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { isValidRoomCode, parseRoomCode } from "@/lib/game/room-code";
import { DIAG_TV_PASS_TTL_MS, diagnosticsEnabled } from "./config";
import { isLoggingPaused, lookupRoomNight, peekRoomNight } from "./write";

// The signing key is derived from the server secret with this label, so the
// key that signs passes is a different key from the one that signs device
// cookies (domain separation). Anything signed with one never verifies as the other.
const KEY_LABEL = "tr1via/diag-tv-pass/signing-key/v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRY_RE = /^[0-9a-z]{1,10}$/;

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

function sign(secret: string, nightId: string, expirySeconds: number): string {
  return createHmac("sha256", signingKey(secret)).update(`${nightId.toLowerCase()}:${expirySeconds}`).digest("base64url");
}

/** A pass for this night, or null (no secret set, or not a night id). */
export function signTvPass(
  nightId: string,
  now: number = Date.now(),
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = env.SESSION_SECRET;
  if (!secret || !UUID_RE.test(nightId)) return null;
  const expiry = Math.floor((now + DIAG_TV_PASS_TTL_MS) / 1000);
  return `v1.${nightId.toLowerCase()}.${expiry.toString(36)}.${sign(secret, nightId, expiry)}`;
}

/** The night id a pass is good for, or null (forged, expired, malformed). Never throws. */
export function verifyTvPass(
  pass: unknown,
  now: number = Date.now(),
  env: Record<string, string | undefined> = process.env,
): string | null {
  try {
    const secret = env.SESSION_SECRET;
    if (!secret || typeof pass !== "string" || pass.length > 200) return null;
    const parts = pass.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return null;
    const [, nightId, expiryText, signature] = parts as [string, string, string, string];
    if (!UUID_RE.test(nightId) || !EXPIRY_RE.test(expiryText)) return null;
    const expiry = parseInt(expiryText, 36);
    if (!Number.isFinite(expiry)) return null;
    const expiresAt = expiry * 1000;
    // Expired, or claiming to last far longer than a pass ever does.
    if (expiresAt <= now || expiresAt > now + DIAG_TV_PASS_TTL_MS + 60_000) return null;
    const wanted = Buffer.from(sign(secret, nightId, expiry));
    const given = Buffer.from(signature);
    if (wanted.length !== given.length || !timingSafeEqual(wanted, given)) return null;
    return nightId.toLowerCase();
  } catch {
    return null;
  }
}

// The pass is issued while the TV PAGE renders, which is outside every log job
// (and so outside the turns, the queue and the pause in write.ts). The page is
// public, so anyone can load /tv/<any code>. To keep logging from adding reads for
// junk loads:
//   1. a code that is not in the room-code format costs nothing;
//   2. a code already known (found for ten minutes, not found for 30 seconds) costs
//      nothing: it is answered from memory;
//   3. only a code never seen before reaches the database, and only a few per
//      minute (a small bucket that refills slowly: a real venue loads its TV page a
//      handful of times a night), at most 3 at once, and none at all while logging
//      is paused because the database is in trouble;
//   4. any other load simply gets no pass: its TV page is not logged until it is reloaded.
const LOOKUP_BURST = 10;
const LOOKUP_REFILL_PER_MS = 10 / 60_000;
const LOOKUP_IN_FLIGHT_MAX = 3;
let lookupTokens = LOOKUP_BURST;
let lookupRefilledAt = 0;
let lookupsRunning = 0;

function takeLookupTurn(now: number = Date.now()): boolean {
  if (lookupRefilledAt === 0) lookupRefilledAt = now;
  lookupTokens = Math.min(LOOKUP_BURST, lookupTokens + (now - lookupRefilledAt) * LOOKUP_REFILL_PER_MS);
  lookupRefilledAt = now;
  if (lookupTokens < 1 || lookupsRunning >= LOOKUP_IN_FLIGHT_MAX) return false;
  lookupTokens -= 1;
  lookupsRunning += 1;
  return true;
}

/** Test hook: a full bucket and nothing in flight. */
export function __resetTvPassLimitsForTests(): void {
  lookupTokens = LOOKUP_BURST;
  lookupRefilledAt = 0;
  lookupsRunning = 0;
}

/**
 * The pass for the TV page of this room, or null (logging off, a code that is
 * not a real room, a code the limits above turned away, or any trouble). Never throws.
 */
export async function issueTvPassForRoom(roomCodeRaw: string): Promise<string | null> {
  try {
    if (!diagnosticsEnabled()) return null;
    const code = parseRoomCode(roomCodeRaw);
    if (!isValidRoomCode(code)) return null;
    let nightId = peekRoomNight(code);
    if (nightId === undefined) {
      if (isLoggingPaused() || !takeLookupTurn()) return null;
      try {
        nightId = await lookupRoomNight(code);
      } finally {
        lookupsRunning = Math.max(0, lookupsRunning - 1);
      }
    }
    return nightId ? signTvPass(nightId) : null;
  } catch {
    return null;
  }
}
