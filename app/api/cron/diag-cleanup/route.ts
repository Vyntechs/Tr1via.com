// GET /api/cron/diag-cleanup — the daily 45-day cleanup of the diagnostic log.
//
// Called once a day by the Vercel cron entry in vercel.json (Production only).
//
//   - It needs "Authorization: Bearer <CRON_SECRET>" (Vercel sends it when a
//     CRON_SECRET environment variable is set). No secret set, or the wrong
//     one: 401 and nothing is cleaned. A secret that IS set but shorter than 16
//     characters (too easy to guess) is refused too, but LOUDLY: one line in the
//     server log and a 500 saying so (no secret in it), so the daily cleanup
//     can never stop without anyone being able to see why. That is the ONLY gate: it runs whether
//     logging is on or off, so turning logging off never leaves old rows
//     behind. On empty tables (the usual state while logging has never been
//     on) it removes nothing.
//   - It deletes in small batches of 5,000 rows, each batch its own database
//     transaction, up to 20 batches per run, so after a flood it still makes
//     progress and the next day's run carries on (`more: true` says there was
//     more left). See runDiagCleanup in lib/diagnostics/write.ts.
//   - The number of days is fixed (45) in lib/diagnostics/config.ts and is
//     never read from the request. The database function also refuses fewer
//     than 7 days.
//
// It never touches game tables, and nothing in the game calls it.

import { timingSafeEqual } from "node:crypto";
import { DIAG_RETENTION_DAYS } from "@/lib/diagnostics/config";
import { runDiagCleanup } from "@/lib/diagnostics/write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NO_STORE = { "Cache-Control": "no-store" };

/** A shorter secret is refused outright, and said so (see GET). */
const MIN_SECRET_LENGTH = 16;

function secretMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const given = Buffer.from(header);
  const wanted = Buffer.from(`Bearer ${secret}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && secret.length < MIN_SECRET_LENGTH) {
    // Not silent: without this the cleanup would stop for good with nothing to read.
    // Neither the secret nor its length is printed or returned.
    console.error("[diag] cleanup NOT running: CRON_SECRET is set but shorter than 16 characters. Set a longer one.");
    return Response.json({ ok: false, error: "CRON_SECRET is shorter than 16 characters; cleanup did not run" }, { status: 500, headers: NO_STORE });
  }
  if (!secret || !secretMatches(req.headers.get("authorization"), secret)) {
    return new Response(null, { status: 401, headers: NO_STORE });
  }

  const result = await runDiagCleanup();
  if (!result.ok) {
    return Response.json(
      { ok: false, code: result.code, removed: result.removed },
      { status: 500, headers: NO_STORE },
    );
  }
  return Response.json(
    { ok: true, days: DIAG_RETENTION_DAYS, removed: result.removed, batches: result.batches, more: result.more },
    { headers: NO_STORE },
  );
}
