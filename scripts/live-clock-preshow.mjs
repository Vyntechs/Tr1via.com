// Pre-show check for the database clock: job ticking, mode correct,
// only_night_id empty, no unsent rows. Read-only.
//   node --env-file=.env.local scripts/live-clock-preshow.mjs [expected-mode]
// Prints one PASS or FAIL line and exits 1 on FAIL.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("FAIL needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await admin.rpc("live_clock_preshow_check", {
  p_expected_mode: process.argv[2] ?? "on",
});
if (error) {
  console.error(`FAIL could not run the check: ${error.message}`);
  process.exit(1);
}
console.log(
  data.ok
    ? `PASS mode ${data.mode}, ${data.liveGames} live games, last tick ${data.lastTickAt ?? "none"}`
    : `FAIL ${data.problems.join("; ")}`,
);
process.exit(data.ok ? 0 : 1);
