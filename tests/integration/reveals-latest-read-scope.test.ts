// @vitest-environment node
//
// The host laptop's "newest reveal" read, scoped by game_id — REAL Postgres.
//
// useRoom used to read the newest reveal with `reveals ⨝ games ON night_id`.
// The reveals_read policy (0002_rls.sql) runs a per-row permission check, and
// with the join Postgres ran it over EVERY night's reveals (~4,800 rows live,
// ~1s) before the join could throw them away. The laptop now looks up the
// night's game ids first and asks for `game_id IN (those)`, so the check only
// runs on this night's rows. The policy itself is unchanged.
//
// This proves, on the real migrations and the real role model:
//   1. the scoped read returns exactly the row the joined read did, for every
//      kind of caller (owning host, another host, a player in the night, a
//      player of another night, a caller with no identity);
//   2. anyone without access is still refused (zero rows);
//   3. the permission check only runs on this night's rows.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

const OTHER_NIGHT_REVEALS = 120;
const THIS_NIGHT_REVEALS = 3;

// What the laptop asked before: reveals joined to games on night_id. This is
// the SQL PostgREST writes for `select=*,games!inner(night_id)&games.night_id=eq.X`.
const JOINED_READ = `
  select r.id from reveals r
  left join lateral (
    select g.night_id from games g where g.id = r.game_id and g.night_id = $1
  ) gg on true
  where gg is not null
  order by r.occurred_at desc limit 1`;
// What it asks now: reveals for the night's own game ids.
const SCOPED_READ = `
  select r.id from reveals r
  where r.game_id = any($1::uuid[])
  order by r.occurred_at desc limit 1`;

describe("newest-reveal read scoped by game_id", () => {
  let db: PGlite;
  let nightA: string;
  let gameIdsA: string[];
  let newestA: string;
  let hostAUser: string;
  let hostBUser: string;
  const deviceInA = "11111111-1111-1111-1111-111111111111";
  const deviceInB = "22222222-2222-2222-2222-222222222222";

  type Caller = { role: "anon" | "authenticated"; device?: string; authUid?: string };

  async function runAs<T extends Record<string, unknown>>(
    caller: Caller,
    sql: string,
    params: unknown[] = [],
  ) {
    const headers = caller.device ? JSON.stringify({ "x-tr1via-device": caller.device }) : "{}";
    await db.exec(`select set_config('request.headers', '${headers}', false);`);
    await db.exec(`select set_config('test.auth_uid', '${caller.authUid ?? ""}', false);`);
    await db.exec(`set role ${caller.role};`);
    try {
      return await db.query<T>(sql, params);
    } finally {
      await db.exec(
        `reset role; select set_config('request.headers', '', false); select set_config('test.auth_uid', '', false);`,
      );
    }
  }

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema if not exists extensions;
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key default gen_random_uuid());
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.auth_uid', true), '')::uuid
      $$;
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"));
    await db.exec(`
      grant usage on schema public to anon, authenticated, service_role;
      grant select, insert, update, delete on all tables in schema public to anon, authenticated;
      grant all on all tables in schema public to service_role;
      grant execute on all functions in schema public to anon, authenticated, service_role;
    `);
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0002_rls.sql"), "utf8"));

    const one = async (sql: string, params: unknown[] = []) =>
      (await db.query<{ id: string }>(sql + " returning id", params)).rows[0].id;

    hostAUser = (await db.query<{ id: string }>("insert into auth.users default values returning id")).rows[0].id;
    hostBUser = (await db.query<{ id: string }>("insert into auth.users default values returning id")).rows[0].id;
    const hostA = await one("insert into hosts (user_id, display_name) values ($1, 'A')", [hostAUser]);
    const hostB = await one("insert into hosts (user_id, display_name) values ($1, 'B')", [hostBUser]);
    nightA = await one("insert into nights (host_id, venue_name, room_code) values ($1, 'A', 'ROOMAA')", [hostA]);
    const nightB = await one("insert into nights (host_id, venue_name, room_code) values ($1, 'B', 'ROOMBB')", [hostB]);
    gameIdsA = [
      await one("insert into games (night_id, game_no) values ($1, 1)", [nightA]),
      await one("insert into games (night_id, game_no) values ($1, 2)", [nightA]),
    ];
    const gameB = await one("insert into games (night_id, game_no) values ($1, 1)", [nightB]);
    await db.query("insert into players (night_id, device_id, display_name) values ($1, $2, 'Pat')", [nightA, deviceInA]);
    await db.query("insert into players (night_id, device_id, display_name) values ($1, $2, 'Quinn')", [nightB, deviceInB]);

    const catA = await one(
      "insert into categories (game_id, name, topic, position) values ($1, 'c', 't', 0)",
      [gameIdsA[0]],
    );
    const questionA = await one(
      "insert into questions (category_id, prompt, options, correct_index, point_value) values ($1, 'q', '[\"a\",\"b\",\"c\",\"d\"]', 0, 100)",
      [catA],
    );
    const catB = await one(
      "insert into categories (game_id, name, topic, position) values ($1, 'c', 't', 0)",
      [gameB],
    );
    const questionB = await one(
      "insert into questions (category_id, prompt, options, correct_index, point_value) values ($1, 'q', '[\"a\",\"b\",\"c\",\"d\"]', 0, 100)",
      [catB],
    );

    // Other nights' reveals are NEWER than this night's, so a read that ignored
    // the night would return the wrong row, and there are many of them.
    for (let i = 0; i < THIS_NIGHT_REVEALS; i += 1) {
      newestA = await one(
        "insert into reveals (game_id, question_id, event, occurred_at) values ($1, $2, 'reveal', now() - interval '10 minutes' + ($3 || ' seconds')::interval)",
        [gameIdsA[i % 2], questionA, String(i)],
      );
    }
    for (let i = 0; i < OTHER_NIGHT_REVEALS; i += 1) {
      await db.query(
        "insert into reveals (game_id, question_id, event, occurred_at) values ($1, $2, 'reveal', now() - interval '1 minute' + ($3 || ' milliseconds')::interval)",
        [gameB, questionB, String(i)],
      );
    }
    await db.exec("analyze");
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  const callers: Array<{ name: string; caller: () => Caller; sees: boolean }> = [
    { name: "the host who owns the night", caller: () => ({ role: "authenticated", authUid: hostAUser }), sees: true },
    { name: "a player in the night", caller: () => ({ role: "anon", device: deviceInA }), sees: true },
    { name: "another host", caller: () => ({ role: "authenticated", authUid: hostBUser }), sees: false },
    { name: "a player of a different night", caller: () => ({ role: "anon", device: deviceInB }), sees: false },
    { name: "a caller with no identity", caller: () => ({ role: "anon" }), sees: false },
  ];

  for (const { name, caller, sees } of callers) {
    test(`${name}: scoped read returns exactly what the joined read did`, async () => {
      const joined = await runAs(caller(), JOINED_READ, [nightA]);
      const scoped = await runAs(caller(), SCOPED_READ, [gameIdsA]);

      expect(scoped.rows).toEqual(joined.rows);
      if (sees) {
        expect(scoped.rows).toEqual([{ id: newestA }]);
      } else {
        expect(scoped.rows).toEqual([]);
      }
    });
  }

  test("the permission check runs only on this night's rows, not every night's", async () => {
    async function checks(sql: string, params: unknown[]): Promise<number> {
      const res = await runAs<{ "QUERY PLAN": unknown }>(
        { role: "authenticated", authUid: hostAUser },
        `explain (analyze, format json) ${sql}`,
        params,
      );
      const plan = res.rows[0]["QUERY PLAN"];
      const root = (typeof plan === "string" ? JSON.parse(plan) : plan) as Array<{ Plan: unknown }>;
      let max = 0;
      const walk = (node: Record<string, unknown>) => {
        if (typeof node["Subplan Name"] === "string") {
          max = Math.max(max, Number(node["Actual Loops"] ?? 0));
        }
        for (const child of (node.Plans as Array<Record<string, unknown>> | undefined) ?? []) walk(child);
      };
      walk(root[0].Plan as Record<string, unknown>);
      return max;
    }

    const joinedChecks = await checks(JOINED_READ, [nightA]);
    const scopedChecks = await checks(SCOPED_READ, [gameIdsA]);

    // Before: the check ran over (nearly) all rows of every night. Now: only
    // this night's rows.
    expect(joinedChecks).toBeGreaterThanOrEqual(OTHER_NIGHT_REVEALS);
    expect(scopedChecks).toBeLessThanOrEqual(THIS_NIGHT_REVEALS);
  });
});
