// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
const SCHEMA_MIGRATION = path.join(MIGRATIONS_DIR, "0022_live_answer_engine_schema.sql");
const FUNCTIONS_MIGRATION = path.join(MIGRATIONS_DIR, "0023_live_answer_engine_functions.sql");
const hasSchemaMigration = existsSync(SCHEMA_MIGRATION);
const hasFunctionsMigration = existsSync(FUNCTIONS_MIGRATION);

const SERVER_ONLY_TABLES = [
  "host_answer_engine_settings",
  "live_command_receipts",
  "question_plays",
  "question_play_eligibility",
  "question_play_answers",
  "question_play_attempt_windows",
  "play_finalize_attempt_windows",
  "live_room_events",
] as const;

const ENGINE_RPCS = [
  "begin_question_play_final_window",
  "end_live_game",
  "finalize_current_play_if_due",
  "open_night_run",
  "open_question_play",
  "start_live_game",
  "submit_question_play_answer",
  "undo_question_play",
] as const;

const NON_UNDONE_PLAY_STATES = ["accepting", "all_in_hold", "final_window", "resolved"];

function unwrapOuterParentheses(value: string): string {
  let result = value.trim();
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth = 0;
    let wrapsWholeExpression = true;
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === "(") depth += 1;
      if (result[index] === ")") depth -= 1;
      if (depth === 0 && index < result.length - 1) {
        wrapsWholeExpression = false;
        break;
      }
    }
    if (!wrapsWholeExpression || depth !== 0) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

function isExactNonUndonePredicate(predicate: string): boolean {
  let normalized = predicate
    .toLowerCase()
    .replace(/^\s*where\b/, "")
    .replace(/::(?:pg_catalog\.)?text\b/g, "")
    .replace(/"/g, "")
    .trim();
  normalized = unwrapOuterParentheses(normalized);
  normalized = normalized
    .replace(/\(\s*status\s*\)/g, "status")
    .replace(/\(\s*('[^']*')\s*\)/g, "$1")
    .replace(/\s+/g, "");

  if (/^status(?:<>|!=)'undone'$/.test(normalized)) return true;

  const setMatch = normalized.match(/^statusin\((.*)\)$/)
    ?? normalized.match(/^status=any\(array\[(.*)\]\)$/);
  if (!setMatch) return false;
  const states = setMatch[1].split(",").map((value) => value.replace(/^'|'$/g, "")).sort();
  return states.length === NON_UNDONE_PLAY_STATES.length
    && states.every((state, index) => state === [...NON_UNDONE_PLAY_STATES].sort()[index]);
}

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
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
    create publication supabase_realtime;
  `);

  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0001_init.sql"), "utf8"));
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    grant all on all tables in schema public to service_role;
    grant execute on all functions in schema public to anon, authenticated, service_role;
  `);
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0002_rls.sql"), "utf8"));
  await db.exec(readFileSync(path.join(MIGRATIONS_DIR, "0021_live_security_gate.sql"), "utf8"));

  for (const migration of [SCHEMA_MIGRATION, FUNCTIONS_MIGRATION]) {
    if (existsSync(migration)) await db.exec(readFileSync(migration, "utf8"));
  }
  return db;
}

const ANCESTRY = {
  hostUser: "10000000-0000-0000-0000-000000000001",
  host: "10000000-0000-0000-0000-000000000002",
  nightA: "10000000-0000-0000-0000-000000000003",
  nightB: "10000000-0000-0000-0000-000000000004",
  runA: "10000000-0000-0000-0000-000000000005",
  runB: "10000000-0000-0000-0000-000000000006",
  gameA: "10000000-0000-0000-0000-000000000007",
  gameB: "10000000-0000-0000-0000-000000000008",
  categoryA: "10000000-0000-0000-0000-000000000009",
  categoryB: "10000000-0000-0000-0000-000000000010",
  questionA: "10000000-0000-0000-0000-000000000011",
  questionB: "10000000-0000-0000-0000-000000000012",
  playerA: "10000000-0000-0000-0000-000000000013",
  playerB: "10000000-0000-0000-0000-000000000014",
  playA: "10000000-0000-0000-0000-000000000015",
} as const;

async function seedAncestryFixture(db: PGlite): Promise<void> {
  await db.query("insert into auth.users (id) values ($1)", [ANCESTRY.hostUser]);
  await db.query(
    "insert into hosts (id, user_id, display_name) values ($1, $2, 'Host')",
    [ANCESTRY.host, ANCESTRY.hostUser],
  );
  await db.query(
    `insert into nights (id, host_id, venue_name, room_code, current_run_id) values
      ($1, $3, 'Venue A', 'RUNAAA', $4),
      ($2, $3, 'Venue B', 'RUNBBB', $5)`,
    [ANCESTRY.nightA, ANCESTRY.nightB, ANCESTRY.host, ANCESTRY.runA, ANCESTRY.runB],
  );
  await db.query(
    `insert into games (id, night_id, game_no) values
      ($1, $3, 1),
      ($2, $4, 1)`,
    [ANCESTRY.gameA, ANCESTRY.gameB, ANCESTRY.nightA, ANCESTRY.nightB],
  );
  await db.query(
    `insert into categories (id, game_id, name, topic, position) values
      ($1, $3, 'A', 'A', 0),
      ($2, $4, 'B', 'B', 0)`,
    [ANCESTRY.categoryA, ANCESTRY.categoryB, ANCESTRY.gameA, ANCESTRY.gameB],
  );
  await db.query(
    `insert into questions (id, category_id, prompt, options, correct_index) values
      ($1, $3, 'A?', '["A","B","C","D"]'::jsonb, 0),
      ($2, $4, 'B?', '["A","B","C","D"]'::jsonb, 0)`,
    [ANCESTRY.questionA, ANCESTRY.questionB, ANCESTRY.categoryA, ANCESTRY.categoryB],
  );
  await db.query(
    `insert into players (id, night_id, device_id, display_name) values
      ($1, $3, '20000000-0000-0000-0000-000000000001', 'Player A'),
      ($2, $4, '20000000-0000-0000-0000-000000000002', 'Player B')`,
    [ANCESTRY.playerA, ANCESTRY.playerB, ANCESTRY.nightA, ANCESTRY.nightB],
  );
}

async function hasColumn(db: PGlite, table: string, column: string): Promise<boolean> {
  const result = await db.query<{ exists: boolean }>(`
    select exists (
      select 1
        from information_schema.columns
       where table_schema = 'public'
         and table_name = $1
         and column_name = $2
    )
  `, [table, column]);
  return result.rows[0]?.exists ?? false;
}

async function insertProbePlay(
  db: PGlite,
  values: {
    id?: string;
    nightId: string;
    runId: string;
    gameId: string;
    categoryId: string;
    questionId: string;
  },
): Promise<void> {
  const includeCategory = await hasColumn(db, "question_plays", "category_id");
  if (includeCategory) {
    await db.query(
      `insert into question_plays (
         id, night_id, run_id, game_id, category_id, question_id,
         status, opened_at, main_zero_at, final_window_ends_at
       ) values (
         $1, $2, $3, $4, $5, $6,
         'accepting', now(), now() + interval '20 seconds', now() + interval '22 seconds'
       )`,
      [
        values.id ?? ANCESTRY.playA,
        values.nightId,
        values.runId,
        values.gameId,
        values.categoryId,
        values.questionId,
      ],
    );
    return;
  }

  await db.query(
    `insert into question_plays (
       id, night_id, run_id, game_id, question_id,
       status, opened_at, main_zero_at, final_window_ends_at
     ) values (
       $1, $2, $3, $4, $5,
       'accepting', now(), now() + interval '20 seconds', now() + interval '22 seconds'
     )`,
    [
      values.id ?? ANCESTRY.playA,
      values.nightId,
      values.runId,
      values.gameId,
      values.questionId,
    ],
  );
}

async function insertProbeEligibility(
  db: PGlite,
  playId: string,
  playerId: string,
  nightId: string,
): Promise<void> {
  const includeNight = await hasColumn(db, "question_play_eligibility", "night_id");
  const values = [playId, playerId, ...(includeNight ? [nightId] : [])];
  await db.query(
    `insert into question_play_eligibility (
       play_id, player_id${includeNight ? ", night_id" : ""}
     ) values ($1, $2${includeNight ? ", $3" : ""})`,
    values,
  );
}

describe("authoritative live answer engine schema", () => {
  test("accepts only the exact non-undone partial-index predicate", () => {
    for (const predicate of [
      "where status <> 'undone'",
      "WHERE ((status != ('undone'::text)))",
      "where status in ('resolved', 'accepting', 'final_window', 'all_in_hold')",
      "where status = any (array['accepting'::text, 'all_in_hold'::text, 'final_window'::text, 'resolved'::text])",
    ]) {
      expect(isExactNonUndonePredicate(predicate), predicate).toBe(true);
    }

    for (const predicate of [
      "where status <> 'undone' and status <> 'resolved'",
      "where status <> 'undone' or status is null",
      "where status not in ('accepting', 'all_in_hold', 'final_window', 'resolved')",
      "where status in ('accepting', 'all_in_hold', 'final_window', 'resolved', 'paused')",
      "where status in ('accepting', 'all_in_hold', 'final_window')",
      "where status = 'undone'",
    ]) {
      expect(isExactNonUndonePredicate(predicate), predicate).toBe(false);
    }
  });

  test("requires migration 0022", () => {
    expect(hasSchemaMigration).toBe(true);
  });

  test("requires migration 0023", () => {
    expect(hasFunctionsMigration).toBe(true);
  });

  describe.skipIf(!hasSchemaMigration)("0022 schema contract", () => {
    let db: PGlite;

    beforeAll(async () => {
      db = await freshDb();
    });

    afterAll(async () => {
      await db?.close();
    });

    test("adds the immutable engine latch, run revisions, and answer eligibility columns", async () => {
      const columns = await db.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(`
        select table_name, column_name, data_type, is_nullable, column_default
          from information_schema.columns
         where table_schema = 'public'
           and (
             (table_name = 'players' and column_name = 'can_answer')
             or
             (table_name = 'nights' and column_name in (
               'answer_engine', 'answer_engine_latched_at', 'current_run_id',
               'room_revision', 'control_revision'
             ))
           )
         order by table_name, column_name
      `);

      expect(columns.rows).toEqual([
        expect.objectContaining({
          table_name: "nights",
          column_name: "answer_engine",
          data_type: "text",
          is_nullable: "NO",
          column_default: expect.stringContaining("legacy"),
        }),
        expect.objectContaining({
          table_name: "nights",
          column_name: "answer_engine_latched_at",
          data_type: "timestamp with time zone",
          is_nullable: "YES",
        }),
        expect.objectContaining({
          table_name: "nights",
          column_name: "control_revision",
          data_type: "bigint",
          is_nullable: "NO",
          column_default: expect.stringMatching(/^0/),
        }),
        expect.objectContaining({
          table_name: "nights",
          column_name: "current_run_id",
          data_type: "uuid",
          is_nullable: "YES",
        }),
        expect.objectContaining({
          table_name: "nights",
          column_name: "room_revision",
          data_type: "bigint",
          is_nullable: "NO",
          column_default: expect.stringMatching(/^0/),
        }),
        expect.objectContaining({
          table_name: "players",
          column_name: "can_answer",
          data_type: "boolean",
          is_nullable: "NO",
          column_default: "true",
        }),
      ]);
    });

    test("creates every server-owned engine table with RLS enabled", async () => {
      const tables = await db.query<{ relname: string; relrowsecurity: boolean }>(`
        select c.relname, c.relrowsecurity
          from pg_catalog.pg_class c
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind = 'r'
           and c.relname = any($1::text[])
         order by c.relname
      `, [SERVER_ONLY_TABLES]);

      expect(tables.rows.map((row) => row.relname)).toEqual([...SERVER_ONLY_TABLES].sort());
      expect(tables.rows.every((row) => row.relrowsecurity)).toBe(true);
    });

    test("pins engine and play states to the supported values", async () => {
      const checks = await db.query<{ table_name: string; definition: string }>(`
        select c.relname as table_name, pg_catalog.pg_get_constraintdef(k.oid) as definition
          from pg_catalog.pg_constraint k
          join pg_catalog.pg_class c on c.oid = k.conrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and k.contype = 'c'
           and c.relname in ('nights', 'host_answer_engine_settings', 'question_plays')
      `);
      const assertExactCheckValues = (table: string, column: string, expected: string[]) => {
        const matching = checks.rows.filter(
          (row) => row.table_name === table
            && row.definition.includes(column)
            && expected.every((value) => row.definition.includes(`'${value}'`)),
        );
        expect(matching, `${table}.${column}`).toHaveLength(1);
        const definition = matching[0].definition.toLowerCase().replace(/::text/g, "");
        expect(definition, `${table}.${column}`).toMatch(
          new RegExp(`${column}\\s*(?:in\\s*\\(|=\\s*any\\s*\\(\\s*array\\[)`),
        );
        expect(definition, `${table}.${column}`).not.toMatch(/\bnot\b/);
        const values = [...definition.matchAll(/'([^']+)'/g)]
          .map((match) => match[1])
          .sort();
        expect(values, `${table}.${column}`).toEqual([...expected].sort());
      };

      assertExactCheckValues("nights", "answer_engine", ["legacy", "resilient_v1"]);
      assertExactCheckValues("host_answer_engine_settings", "preferred_engine", [
        "legacy",
        "resilient_v1",
      ]);
      assertExactCheckValues("question_plays", "status", [
        "accepting",
        "all_in_hold",
        "final_window",
        "resolved",
        "undone",
      ]);
    });

    test("allows only one unfinished play and one non-undone play per run and question", async () => {
      const indexes = await db.query<{ indexdef: string }>(`
        select indexdef
          from pg_catalog.pg_indexes
         where schemaname = 'public' and tablename = 'question_plays'
      `);
      const definitions = indexes.rows.map((row) =>
        row.indexdef.toLowerCase().replace(/::text/g, "").replace(/\s+/g, " "),
      );
      const unfinished = definitions.find((definition) =>
        definition.includes("unique")
        && definition.includes("run_id")
        && definition.includes("where")
        && ["accepting", "all_in_hold", "final_window"].every((state) => definition.includes(state)),
      );
      expect(unfinished).toBeDefined();
      const unfinishedKey = unfinished?.match(/using\s+\w+\s*\(([^)]*)\)\s+where/)?.[1]
        .replace(/["\s]/g, "");
      expect(unfinishedKey).toBe("run_id");
      const unfinishedPredicate = unfinished?.slice(unfinished.indexOf("where"));
      expect(unfinishedPredicate).toMatch(
        /where.*status\s*(?:in\s*\(|=\s*any\s*\(\s*array\[)/,
      );
      expect(unfinishedPredicate).not.toMatch(/\bnot\b/);
      expect(unfinishedPredicate).not.toMatch(/resolved|undone/);

      const onePerQuestion = definitions.find((definition) =>
        definition.includes("unique")
        && definition.includes("run_id")
        && definition.includes("question_id")
        && definition.includes("where"),
      );
      expect(onePerQuestion).toBeDefined();
      const onePerQuestionKey = onePerQuestion
        ?.match(/using\s+\w+\s*\(([^)]*)\)\s+where/)?.[1]
        .replace(/["\s]/g, "");
      expect(onePerQuestionKey).toBe("run_id,question_id");
      const onePerQuestionPredicate = onePerQuestion?.slice(onePerQuestion.indexOf("where"));
      expect(isExactNonUndonePredicate(onePerQuestionPredicate ?? "")).toBe(true);
    });

    test("prevents an answer unless the player belongs to that play's frozen eligibility set", async () => {
      const foreignKeys = await db.query<{ definition: string }>(`
        select pg_catalog.pg_get_constraintdef(k.oid) as definition
          from pg_catalog.pg_constraint k
          join pg_catalog.pg_class c on c.oid = k.conrelid
          join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = 'question_play_answers'
           and k.contype = 'f'
      `);
      const normalized = foreignKeys.rows
        .map((row) => row.definition.replace(/\s+/g, " ").toLowerCase())
        .join("\n");

      expect(normalized).toMatch(
        /foreign key \(play_id, player_id\) references question_play_eligibility\(play_id, player_id\)/,
      );
    });

    test.each([
      {
        label: "run from another night",
        nightId: ANCESTRY.nightA,
        runId: ANCESTRY.runB,
        gameId: ANCESTRY.gameA,
        categoryId: ANCESTRY.categoryA,
        questionId: ANCESTRY.questionA,
      },
      {
        label: "game and question from another night",
        nightId: ANCESTRY.nightA,
        runId: ANCESTRY.runA,
        gameId: ANCESTRY.gameB,
        categoryId: ANCESTRY.categoryB,
        questionId: ANCESTRY.questionB,
      },
      {
        label: "question from another game",
        nightId: ANCESTRY.nightA,
        runId: ANCESTRY.runA,
        gameId: ANCESTRY.gameA,
        categoryId: ANCESTRY.categoryB,
        questionId: ANCESTRY.questionB,
      },
    ])("rejects a question play with $label", async (probe) => {
      const probeDb = await freshDb();
      try {
        await seedAncestryFixture(probeDb);
        await expect(insertProbePlay(probeDb, probe)).rejects.toThrow(/foreign key|constraint/i);
      } finally {
        await probeDb.close();
      }
    });

    test("rejects eligibility for a player from another night", async () => {
      const probeDb = await freshDb();
      try {
        await seedAncestryFixture(probeDb);
        await insertProbePlay(probeDb, {
          nightId: ANCESTRY.nightA,
          runId: ANCESTRY.runA,
          gameId: ANCESTRY.gameA,
          categoryId: ANCESTRY.categoryA,
          questionId: ANCESTRY.questionA,
        });

        await expect(
          insertProbeEligibility(probeDb, ANCESTRY.playA, ANCESTRY.playerB, ANCESTRY.nightA),
        ).rejects.toThrow(/foreign key|constraint/i);
      } finally {
        await probeDb.close();
      }
    });

    test.each([
      {
        label: "another night's expected game and play",
        nightId: ANCESTRY.nightB,
        runId: ANCESTRY.runB,
        expectedStatus: "accepting",
      },
      {
        label: "an unsupported expected play status",
        nightId: ANCESTRY.nightA,
        runId: ANCESTRY.runA,
        expectedStatus: "paused",
      },
      {
        label: "a status that disagrees with the referenced play",
        nightId: ANCESTRY.nightA,
        runId: ANCESTRY.runA,
        expectedStatus: "resolved",
      },
    ])("rejects a command receipt with $label", async ({ nightId, runId, expectedStatus }) => {
      const probeDb = await freshDb();
      try {
        await seedAncestryFixture(probeDb);
        await insertProbePlay(probeDb, {
          nightId: ANCESTRY.nightA,
          runId: ANCESTRY.runA,
          gameId: ANCESTRY.gameA,
          categoryId: ANCESTRY.categoryA,
          questionId: ANCESTRY.questionA,
        });
        const includeExpectedStatus = await hasColumn(
          probeDb,
          "live_command_receipts",
          "expected_play_status",
        );

        const receiptValues = [
          nightId,
          runId,
          ANCESTRY.gameA,
          ANCESTRY.playA,
          ...(includeExpectedStatus ? [expectedStatus] : []),
        ];
        await expect(probeDb.query(
          `insert into live_command_receipts (
             night_id, command_id, run_id, kind, request_hash,
             expected_control_revision, expected_game_id, expected_play_id
             ${includeExpectedStatus ? ", expected_play_status" : ""}
           ) values (
             $1, gen_random_uuid(), $2, 'probe', 'probe', 0, $3, $4
             ${includeExpectedStatus ? ", $5" : ""}
           )`,
          receiptValues,
        )).rejects.toThrow(/foreign key|constraint|check/i);
      } finally {
        await probeDb.close();
      }
    });

    test("preserves a valid receipt's expected status after the play advances", async () => {
      const probeDb = await freshDb();
      try {
        await seedAncestryFixture(probeDb);
        await insertProbePlay(probeDb, {
          nightId: ANCESTRY.nightA,
          runId: ANCESTRY.runA,
          gameId: ANCESTRY.gameA,
          categoryId: ANCESTRY.categoryA,
          questionId: ANCESTRY.questionA,
        });
        const commandId = "10000000-0000-0000-0000-000000000016";
        await probeDb.query(
          `insert into live_command_receipts (
             night_id, command_id, run_id, kind, request_hash,
             expected_control_revision, expected_game_id, expected_play_id,
             expected_play_status
           ) values ($1, $2, $3, 'probe', 'probe', 0, $4, $5, 'accepting')`,
          [
            ANCESTRY.nightA,
            commandId,
            ANCESTRY.runA,
            ANCESTRY.gameA,
            ANCESTRY.playA,
          ],
        );

        await probeDb.query(
          "update question_plays set status = 'all_in_hold' where id = $1",
          [ANCESTRY.playA],
        );
        const receipt = await probeDb.query<{ expected_play_status: string }>(
          `select expected_play_status
             from live_command_receipts
            where night_id = $1 and command_id = $2`,
          [ANCESTRY.nightA, commandId],
        );
        expect(receipt.rows[0]?.expected_play_status).toBe("accepting");
      } finally {
        await probeDb.close();
      }
    });

    test("rejects a room event whose ancestry disagrees with its play", async () => {
      const probeDb = await freshDb();
      try {
        await seedAncestryFixture(probeDb);
        await insertProbePlay(probeDb, {
          nightId: ANCESTRY.nightA,
          runId: ANCESTRY.runA,
          gameId: ANCESTRY.gameA,
          categoryId: ANCESTRY.categoryA,
          questionId: ANCESTRY.questionA,
        });

        await expect(probeDb.query(
          `insert into live_room_events (
             night_id, run_id, play_id, game_id, question_id,
             room_revision, control_revision, kind
           ) values ($1, $2, $3, $4, $5, 1, 1, 'play_opened')`,
          [
            ANCESTRY.nightB,
            ANCESTRY.runB,
            ANCESTRY.playA,
            ANCESTRY.gameA,
            ANCESTRY.questionA,
          ],
        )).rejects.toThrow(/foreign key|constraint/i);
      } finally {
        await probeDb.close();
      }
    });

    test("grants every engine table only to service_role", async () => {
      const grants = await db.query<{
        table_name: string;
        grantee: string;
        privilege_type: string;
      }>(`
        select table_name, grantee, privilege_type
          from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name = any($1::text[])
      `, [SERVER_ONLY_TABLES]);

      for (const table of SERVER_ONLY_TABLES) {
        const tableGrants = grants.rows.filter((row) => row.table_name === table);
        expect(tableGrants.some((row) => row.grantee === "service_role")).toBe(true);
        expect(
          tableGrants.filter((row) => ["PUBLIC", "anon", "authenticated"].includes(row.grantee)),
        ).toEqual([]);
      }
    });

    test.each(["anon", "authenticated"])("denies raw %s writes to every engine table", async (role) => {
      await db.exec(`set role ${role}`);
      try {
        for (const table of SERVER_ONLY_TABLES) {
          await expect(db.query(`insert into public.${table} default values`)).rejects.toThrow(
            /permission denied/i,
          );
        }
      } finally {
        await db.exec("reset role");
      }
    });
  });

  describe.skipIf(!hasSchemaMigration || !hasFunctionsMigration)("0023 RPC privilege contract", () => {
    let db: PGlite;

    beforeAll(async () => {
      db = await freshDb();
    });

    afterAll(async () => {
      await db?.close();
    });

    test("grants authoritative mutation RPCs only to service_role", async () => {
      const grants = await db.query<{ routine_name: string; grantee: string; privilege_type: string }>(`
        select routine_name, grantee, privilege_type
          from information_schema.routine_privileges
         where routine_schema = 'public'
           and routine_name = any($1::text[])
      `, [ENGINE_RPCS]);

      for (const routine of ENGINE_RPCS) {
        const routineGrants = grants.rows.filter((row) => row.routine_name === routine);
        expect(routineGrants.filter((row) => row.grantee === "service_role")).toEqual([
          expect.objectContaining({ privilege_type: "EXECUTE" }),
        ]);
        expect(
          routineGrants.filter((row) => ["PUBLIC", "anon", "authenticated"].includes(row.grantee)),
        ).toEqual([]);
      }
    });

    test.each(["anon", "authenticated"])("denies direct %s RPC execution", async (role) => {
      const calls = [
        "select public.open_night_run(null::uuid, null::uuid, null::uuid, 0::bigint)",
        "select public.start_live_game(null::uuid, null::uuid, null::uuid, 0::bigint)",
        "select public.open_question_play(null::uuid, null::uuid, null::uuid, null::uuid, 0::bigint)",
        "select public.submit_question_play_answer(null::uuid, null::uuid, null::uuid, null::uuid, 1::smallint)",
        "select public.begin_question_play_final_window(null::uuid, null::uuid, null::uuid, null::uuid, 0::bigint)",
        "select public.finalize_current_play_if_due(null::text, null::uuid, null::uuid)",
        "select public.undo_question_play(null::uuid, null::uuid, null::uuid, null::uuid, 0::bigint)",
        "select public.end_live_game(null::uuid, null::uuid, null::uuid, 0::bigint)",
      ];

      await db.exec(`set role ${role}`);
      try {
        for (const sql of calls) {
          await expect(db.query(sql)).rejects.toThrow(/permission denied/i);
        }
      } finally {
        await db.exec("reset role");
      }
    });
  });
});
