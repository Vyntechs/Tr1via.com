#!/usr/bin/env node
// Prints one night's diagnostic timeline (read-only), in Central time.
//
//   DATABASE_URL=postgres://... node scripts/night-timeline.mjs K9PR4M
//   node scripts/night-timeline.mjs K9PR4M --from "2026-10-07 19:05" --to "2026-10-07 19:08"
//   node scripts/night-timeline.mjs K9PR4M --limit 800
//
// --from / --to are Central time. Without them it prints the first --limit
// rows of the night (default 400). DATABASE_URL defaults to the local
// Supabase database. It only runs a SELECT inside a read-only transaction.
// See docs/diagnostics/night-timeline.md.

import pg from "pg";

const args = process.argv.slice(2);
const room = args[0] && !args[0].startsWith("--") ? args[0] : null;
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? null;
};
if (!room) {
  console.error('Usage: node scripts/night-timeline.mjs <ROOMCODE> [--from "YYYY-MM-DD HH:MM"] [--to "YYYY-MM-DD HH:MM"] [--limit N]');
  process.exit(2);
}
const limit = Math.min(Math.max(Number(flag("limit") ?? 400) || 400, 1), 5000);
const connectionString =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query("begin read only");
  const night = await client.query(
    "select id, venue_name from nights where room_code = $1",
    [room.toUpperCase().replace(/[^A-Z0-9]/g, "")],
  );
  if (night.rowCount === 0) {
    console.error(`No night with room code ${room}.`);
    process.exit(1);
  }
  const { id, venue_name: venue } = night.rows[0];

  const params = [id];
  let where = "night_id = $1";
  const from = flag("from");
  const to = flag("to");
  if (from) {
    params.push(from);
    where += ` and at >= ($${params.length}::timestamp at time zone 'America/Chicago')`;
  }
  if (to) {
    params.push(to);
    where += ` and at <= ($${params.length}::timestamp at time zone 'America/Chicago')`;
  }
  params.push(limit);
  const rows = await client.query(
    `select to_char(at at time zone 'America/Chicago', 'YYYY-MM-DD HH24:MI:SS.MS') as local_time,
            source, who, what, detail
       from diag_night_timeline
      where ${where}
      order by at
      limit $${params.length}`,
    params,
  );

  console.log(`Night ${venue} (${room.toUpperCase()}), ${rows.rowCount} rows, Central time\n`);
  for (const r of rows.rows) {
    const detail = Object.entries(r.detail ?? {})
      .filter(([key]) => key !== "steps")
      .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`)
      .join(" ");
    console.log(`${r.local_time}  ${r.source.padEnd(14)} ${String(r.who).slice(0, 20).padEnd(20)} ${r.what}  ${detail}`);
  }
  await client.query("rollback");
} catch (error) {
  if (String(error?.message).includes("diag_night_timeline")) {
    console.error("The diagnostic tables are not in this database yet (migration 20261007180000_diagnostic_logs.sql).");
    process.exit(1);
  }
  throw error;
} finally {
  await client.end();
}
