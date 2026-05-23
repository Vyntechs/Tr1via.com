// Two-factor gate for /api/_test/* routes:
//   1. process.env.TEST_AUTH_ENABLED === "1" (set by the orchestration script,
//      never in production Vercel env)
//   2. The request carries x-test-secret matching process.env.TEST_SECRET
//
// EITHER missing → return false. Routes that get a false MUST 404 (not 401)
// so an external scanner can't even tell the routes exist.
//
// Defense in depth: if Vercel ever set TEST_AUTH_ENABLED=1 in prod by
// accident, the secret header check still locks unauthorized callers out.

import type { NextRequest } from "next/server";

export function isTestModeEnabled(req: NextRequest | Request): boolean {
  if (process.env.TEST_AUTH_ENABLED !== "1") return false;
  const expected = process.env.TEST_SECRET;
  if (!expected) return false;
  const got = req.headers.get("x-test-secret");
  if (!got) return false;
  // Timing-safe equality
  if (got.length !== expected.length) return false;
  let same = 0;
  for (let i = 0; i < got.length; i++) {
    same |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return same === 0;
}

const TEST_EMAIL_SUFFIX = "@tr1via.test";

/** Strict allowlist for cleanup: only emails ending in @tr1via.test. */
export function isTestEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(TEST_EMAIL_SUFFIX);
}

export const TEST_CONFIG = {
  emailSuffix: TEST_EMAIL_SUFFIX,
  roomCodePrefix: "T", // test rooms always start with T (real codes can too, but combined with email check it's enough)
};
