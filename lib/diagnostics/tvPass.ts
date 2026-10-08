// The venue TV's pass for the diagnostic log.
//
// The TV has no login and no cookie, so without something extra anyone who
// knows a room code could send "TV reports" for that night. Instead the server
// gives the TV PAGE a signed pass when the page loads (app/tv/[code]/layout.tsx),
// and the TV sends it with every report. The pass:
//
//   - names ONE night (the night is read from the pass, never from the report)
//   - stops working after DIAG_TV_PASS_TTL_MS (8 hours)
//   - is signed with SESSION_SECRET (the same server secret that signs device
//     cookies), under its own label, so it cannot be mistaken for a cookie
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
import { lookupRoomNight } from "./write";

const LABEL = "tr1via-diag-tv:v1:";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRY_RE = /^[0-9a-z]{1,10}$/;

function sign(secret: string, nightId: string, expirySeconds: number): string {
  return createHmac("sha256", secret).update(`${LABEL}${nightId.toLowerCase()}:${expirySeconds}`).digest("base64url");
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

/**
 * The pass for the TV page of this room, or null (logging off, a code that is
 * not a real room, or any trouble). The lookup is the same small cached one the
 * rest of the log uses, with its own 2-second limit; it never throws.
 */
export async function issueTvPassForRoom(roomCodeRaw: string): Promise<string | null> {
  try {
    if (!diagnosticsEnabled()) return null;
    const code = parseRoomCode(roomCodeRaw);
    if (!isValidRoomCode(code)) return null;
    const nightId = await lookupRoomNight(code);
    return nightId ? signTvPass(nightId) : null;
  } catch {
    return null;
  }
}
