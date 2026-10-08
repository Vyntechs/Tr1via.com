// GET /api/cron/diag-cleanup — the daily 45-day cleanup of the diagnostic log.
//
// Called once a day by the Vercel cron entry in vercel.json (Production only).
//
//   - Logging off (DIAGNOSTIC_LOGGING unset or "off"): answers 204 at once and
//     does NOTHING. It does not read the secret, open the database or run the
//     cleanup, so merging this with logging off schedules nothing harmful.
//   - Logging on: needs "Authorization: Bearer <CRON_SECRET>" (Vercel sends it
//     when a CRON_SECRET environment variable is set). No secret set, or the
//     wrong one: 401 and nothing is cleaned.
//   - The number of days is fixed (45) in lib/diagnostics/config.ts and is
//     never read from the request. The database function also refuses fewer
//     than 7 days.
//
// It never touches game tables, and nothing in the game calls it.

import { timingSafeEqual } from "node:crypto";
import { DIAG_RETENTION_DAYS, diagnosticsEnabled } from "@/lib/diagnostics/config";
import { runDiagCleanup } from "@/lib/diagnostics/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

function secretMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const given = Buffer.from(header);
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function GET(req: Request) {
  if (!diagnosticsEnabled()) return new Response(null, { status: 204, headers: NO_STORE });

  const secret = process.env.CRON_SECRET;
  if (!secret || !secretMatches(req.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401, headers: NO_STORE });
  }

  const result = await runDiagCleanup();
  if (!result.ok) {
    return Response.json({ ok: false, code: result.code }, { status: 500, headers: NO_STORE });
  }
  return Response.json({ ok: true, days: DIAG_RETENTION_DAYS, removed: result.removed }, { headers: NO_STORE });
}
