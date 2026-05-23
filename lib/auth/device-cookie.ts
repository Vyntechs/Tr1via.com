// Pure helpers for the player device cookie. The cookie value carries the
// device UUID and an HMAC-SHA256 signature, joined with a single ".". This
// lets us verify on read that nothing tampered with the id without needing
// a database lookup.
//
// Format: `${deviceId}.${signatureBase64Url}`
//
// We use `node:crypto` so this is server-only (the cookie is set + verified
// in Route Handlers, never in the browser). Keep this file dependency-free
// of Next so unit tests can import it directly.

import { createHmac, timingSafeEqual } from "node:crypto";

const SEPARATOR = ".";

/**
 * Sign a device id into the cookie wire format. Returns
 * `${deviceId}.${hmacBase64Url}`.
 */
export function signDeviceCookie(deviceId: string, secret: string): string {
  if (!deviceId) throw new Error("signDeviceCookie: deviceId is required");
  if (!secret) throw new Error("signDeviceCookie: secret is required");
  const sig = hmac(deviceId, secret);
  return `${deviceId}${SEPARATOR}${sig}`;
}

/**
 * Verify a cookie value. Returns the deviceId if the signature checks out;
 * returns `null` for any failure mode (missing, malformed, tampered, wrong
 * secret). Never throws on bad input — callers treat null as "no session".
 */
export function verifyDeviceCookie(
  cookieValue: string | null | undefined,
  secret: string,
): string | null {
  if (!cookieValue || !secret) return null;

  const sepIdx = cookieValue.lastIndexOf(SEPARATOR);
  if (sepIdx <= 0 || sepIdx === cookieValue.length - 1) return null;

  const deviceId = cookieValue.slice(0, sepIdx);
  const provided = cookieValue.slice(sepIdx + 1);

  if (!deviceId || !provided) return null;

  let expected: string;
  try {
    expected = hmac(deviceId, secret);
  } catch {
    return null;
  }

  // Compare in constant time. Buffers must be the same length, otherwise
  // timingSafeEqual throws.
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  return deviceId;
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
