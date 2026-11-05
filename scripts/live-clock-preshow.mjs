// Pre-show check for the database clock: all three jobs scheduled, job ticking,
// mode correct, only_night_id empty, no unsent rows. Read-only.
//   node --env-file=.env.local scripts/live-clock-preshow.mjs [expected-mode] [--once]
// With no game live the 1-second job is rightly off, so a pass proves less. The
// script stays running and checks again once a game goes live, which is the check
// that proves the tick. --once skips that and runs a single check.
// Prints a PASS or FAIL line last and exits 1 on FAIL.
import { setTimeout as sleep } from "node:timers/promises";

import { createClient } from "@supabase/supabase-js";

import { runPreshow } from "./live-clock-preshow-run.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("FAIL needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const args = process.argv.slice(2);
const expectedMode = args.find((arg) => !arg.startsWith("--")) ?? "on";
const admin = createClient(url, key, { auth: { persistSession: false } });

async function check() {
  const { data, error } = await admin.rpc("live_clock_preshow_check", {
    p_expected_mode: expectedMode,
  });
  if (error) return { ok: false, problems: [`could not run the check: ${error.message}`] };
  return data;
}

process.exit(
  await runPreshow({
    check,
    sleep,
    now: Date.now,
    log: console.log,
    once: args.includes("--once"),
  }),
);
