// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SCRAMBLE_TEST_VECTORS } from "../../lib/game/scramble";
import { parseLiveAnswerRpcEnvelope } from "../../lib/live-answer/rpcResult";

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

const LIVE = {
  hostUser: "30000000-0000-0000-0000-000000000001",
  host: "30000000-0000-0000-0000-000000000002",
  night: "30000000-0000-0000-0000-000000000003",
  game: "30000000-0000-0000-0000-000000000004",
  category: "30000000-0000-0000-0000-000000000005",
  question: "30000000-0000-0000-0000-000000000006",
  playerA: "30000000-0000-0000-0000-000000000007",
  playerB: "30000000-0000-0000-0000-000000000008",
  playerWatch: "30000000-0000-0000-0000-000000000009",
  deviceA: "40000000-0000-0000-0000-000000000001",
  deviceB: "40000000-0000-0000-0000-000000000002",
  deviceWatch: "40000000-0000-0000-0000-000000000003",
  openCommand: "50000000-0000-0000-0000-000000000001",
  startCommand: "50000000-0000-0000-0000-000000000002",
  revealCommand: "50000000-0000-0000-0000-000000000003",
  finalCommand: "50000000-0000-0000-0000-000000000004",
  undoCommand: "50000000-0000-0000-0000-000000000005",
  endCommand: "50000000-0000-0000-0000-000000000006",
  submissionA: "60000000-0000-0000-0000-000000000001",
  submissionB: "60000000-0000-0000-0000-000000000002",
} as const;

type RpcResult = Record<string, unknown> & {
  code: string;
  applied?: boolean;
  eventKind?: string;
  runId?: string;
  playId?: string;
  roomRevision?: number;
  controlRevision?: number;
};

type RpcEnvelope = {
  freshlyApplied: boolean;
  result: RpcResult;
};

async function seedLiveFixture(db: PGlite, eligiblePlayers = 2): Promise<void> {
  await db.query("insert into auth.users (id) values ($1)", [LIVE.hostUser]);
  await db.query(
    "insert into hosts (id, user_id, display_name) values ($1, $2, 'Host')",
    [LIVE.host, LIVE.hostUser],
  );
  await db.query(
    `insert into nights (id, host_id, venue_name, room_code, answer_engine)
     values ($1, $2, 'Venue', 'ATOMIC', 'resilient_v1')`,
    [LIVE.night, LIVE.host],
  );
  await db.query(
    `insert into games (id, night_id, game_no, state)
     values ($1, $2, 1, 'ready')`,
    [LIVE.game, LIVE.night],
  );
  await db.query(
    `insert into categories (id, game_id, name, topic, position, state)
     values ($1, $2, 'Atomic', 'Atomic', 0, 'ready')`,
    [LIVE.category, LIVE.game],
  );
  await db.query(
    `insert into questions (
       id, category_id, point_value, prompt, options, correct_index, is_picked
     ) values ($1, $2, 500, 'Atomic?', '["A","B","C","D"]'::jsonb, 2, true)`,
    [LIVE.question, LIVE.category],
  );
  await db.query(
    `insert into players (id, night_id, device_id, display_name, can_answer) values
       ($1, $4, $5, 'A', true),
       ($2, $4, $6, 'B', true),
       ($3, $4, $7, 'Watch', false)`,
    [
      LIVE.playerA,
      LIVE.playerB,
      LIVE.playerWatch,
      LIVE.night,
      LIVE.deviceA,
      LIVE.deviceB,
      LIVE.deviceWatch,
    ],
  );
  const participating = [LIVE.playerA, LIVE.playerB].slice(0, eligiblePlayers);
  for (const playerId of participating) {
    await db.query(
      "insert into game_participations (game_id, player_id) values ($1, $2)",
      [LIVE.game, playerId],
    );
  }
}

async function rpc(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<RpcResult> {
  const response = await rpcEnvelope(db, sql, params);
  return response.result;
}

async function rpcEnvelope(
  db: PGlite,
  sql: string,
  params: unknown[] = [],
): Promise<RpcEnvelope> {
  const result = await db.query<{ result: RpcEnvelope }>(sql, params);
  return result.rows[0]?.result ?? {
    freshlyApplied: false,
    result: { code: "missing" },
  };
}

async function openRun(db: PGlite): Promise<RpcResult> {
  return rpc(
    db,
    "select public.open_night_run($1, $2, null::uuid, 0::bigint) as result",
    [LIVE.night, LIVE.openCommand],
  );
}

async function startGame(db: PGlite, runId: string, control = 1): Promise<RpcResult> {
  return rpc(
    db,
    "select public.start_live_game($1, $2, $3, $4::bigint) as result",
    [LIVE.game, runId, LIVE.startCommand, control],
  );
}

async function openPlay(db: PGlite, runId: string, control = 2): Promise<RpcResult> {
  return rpc(
    db,
    "select public.open_question_play($1, $2, $3, $4, $5::bigint) as result",
    [LIVE.game, LIVE.question, runId, LIVE.revealCommand, control],
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

    test("adds a private canonical result slot for immutable answer acknowledgements", async () => {
      const columns = await db.query<{
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(`
        select data_type, is_nullable, column_default
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'question_play_answers'
           and column_name = 'canonical_result'
      `);

      expect(columns.rows).toEqual([{
        data_type: "jsonb",
        is_nullable: "YES",
        column_default: null,
      }]);
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

    test.each(["applied", "rejected"])(
      "rejects a terminal %s command receipt without a canonical result",
      async (status) => {
        const probeDb = await freshDb();
        try {
          await seedAncestryFixture(probeDb);
          await expect(probeDb.query(
            `insert into live_command_receipts (
               night_id, command_id, run_id, kind, request_hash,
               expected_control_revision, status, canonical_result, completed_at
             ) values ($1, gen_random_uuid(), $2, 'probe', 'probe', 0, $3, null, now())`,
            [ANCESTRY.nightA, ANCESTRY.runA, status],
          )).rejects.toThrow(/constraint|check/i);
        } finally {
          await probeDb.close();
        }
      },
    );

    test("accepts an exact receipt retry after the play advances", async () => {
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
             expected_play_status, status, canonical_result, completed_at
           ) values (
             $1, $2, $3, 'probe', 'probe', 0, $4, $5,
             'accepting', 'applied', '{"code":"applied"}'::jsonb, now()
           )`,
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
        const retry = await probeDb.query<{ command_id: string }>(
          `insert into live_command_receipts (
             night_id, command_id, run_id, kind, request_hash,
             expected_control_revision, expected_game_id, expected_play_id,
             expected_play_status
           ) values ($1, $2, $3, 'probe', 'probe', 0, $4, $5, 'accepting')
           on conflict (night_id, command_id) do nothing
           returning command_id`,
          [
            ANCESTRY.nightA,
            commandId,
            ANCESTRY.runA,
            ANCESTRY.gameA,
            ANCESTRY.playA,
          ],
        );
        expect(retry.rows).toEqual([]);

        const receipt = await probeDb.query<{
          expected_play_status: string;
          status: string;
          canonical_result: { code: string };
        }>(
          `select expected_play_status, status, canonical_result
             from live_command_receipts
            where night_id = $1 and command_id = $2`,
          [ANCESTRY.nightA, commandId],
        );
        expect(receipt.rows[0]?.expected_play_status).toBe("accepting");
        expect(receipt.rows[0]?.status).toBe("applied");
        expect(receipt.rows[0]?.canonical_result).toEqual({ code: "applied" });
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

    test("pins every authoritative RPC to SECURITY DEFINER with a fixed search path", async () => {
      const functions = await db.query<{
        proname: string;
        prosecdef: boolean;
        proconfig: string[] | null;
      }>(`
        select p.proname, p.prosecdef, p.proconfig
          from pg_catalog.pg_proc p
          join pg_catalog.pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname = any($1::text[])
         order by p.proname
      `, [ENGINE_RPCS]);

      expect(functions.rows.map((entry) => entry.proname)).toEqual([...ENGINE_RPCS].sort());
      for (const entry of functions.rows) {
        expect(entry.prosecdef, entry.proname).toBe(true);
        expect(entry.proconfig, entry.proname).toContain("search_path=pg_catalog, public");
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

  describe.skipIf(!hasSchemaMigration || !hasFunctionsMigration)("0023 atomic live engine behavior", () => {
    test("never emits a null mutation envelope or missing-command helper result", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const envelope = await db.query<{ result: RpcEnvelope }>(
          "select public._live_mutation_envelope(true, null::jsonb) as result",
        );
        expect(envelope.rows[0]?.result).toEqual({
          freshlyApplied: false,
          result: { code: "corrupt_state", applied: false },
        });

        const missing = await db.query<{ result: RpcResult }>(
          "select public._live_existing_command_result($1, $2, 'missing') as result",
          [LIVE.night, crypto.randomUUID()],
        );
        expect(missing.rows[0]?.result).toEqual({ missing: true });
      } finally {
        await db.close();
      }
    });

    test("fails closed on an exact retry of a legacy terminal receipt with no result", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        const runId = opened.runId as string;
        const commandId = crypto.randomUUID();

        await db.exec(
          "alter table live_command_receipts drop constraint if exists live_command_receipts_terminal_result_required",
        );
        await db.query(
          `insert into live_command_receipts (
             night_id, command_id, run_id, kind, request_hash,
             expected_control_revision, expected_game_id, status,
             canonical_result, completed_at
           ) values (
             $1, $2, $3::uuid, 'start_live_game',
             md5(concat_ws('|', 'start_live_game', $4::uuid::text, $3::uuid::text, '1')),
             1, $4::uuid, 'applied', null, now()
           )`,
          [LIVE.night, commandId, runId, LIVE.game],
        );

        const retry = await rpcEnvelope(
          db,
          "select public.start_live_game($1, $2, $3, 1::bigint) as result",
          [LIVE.game, runId, commandId],
        );
        expect(retry).toEqual({
          freshlyApplied: false,
          result: { code: "corrupt_state", applied: false },
        });

        const state = await db.query<{
          game_state: string;
          room_revision: number;
          control_revision: number;
          events: number;
        }>(
          `select g.state as game_state, n.room_revision, n.control_revision,
                  (select count(*)::int from live_room_events where night_id = n.id) as events
             from nights n join games g on g.night_id = n.id
            where n.id = $1 and g.id = $2`,
          [LIVE.night, LIVE.game],
        );
        expect(state.rows[0]).toEqual({
          game_state: "ready",
          room_revision: 1,
          control_revision: 1,
          events: 1,
        });
      } finally {
        await db.close();
      }
    });

    test("keeps a normal pending command non-fresh and mutation-free", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        const runId = opened.runId as string;
        const commandId = crypto.randomUUID();
        await db.query(
          `insert into live_command_receipts (
             night_id, command_id, run_id, kind, request_hash,
             expected_control_revision, expected_game_id
           ) values (
             $1, $2, $3::uuid, 'start_live_game',
             md5(concat_ws('|', 'start_live_game', $4::uuid::text, $3::uuid::text, '1')),
             1, $4::uuid
           )`,
          [LIVE.night, commandId, runId, LIVE.game],
        );

        expect(await rpcEnvelope(
          db,
          "select public.start_live_game($1, $2, $3, 1::bigint) as result",
          [LIVE.game, runId, commandId],
        )).toEqual({
          freshlyApplied: false,
          result: { code: "retry_later", retryAfterMs: 100 },
        });

        const state = await db.query<{
          game_state: string;
          room_revision: number;
          control_revision: number;
          events: number;
        }>(
          `select g.state as game_state, n.room_revision, n.control_revision,
                  (select count(*)::int from live_room_events where night_id = n.id) as events
             from nights n join games g on g.night_id = n.id
            where n.id = $1 and g.id = $2`,
          [LIVE.night, LIVE.game],
        );
        expect(state.rows[0]).toEqual({
          game_state: "ready",
          room_revision: 1,
          control_revision: 1,
          events: 1,
        });
      } finally {
        await db.close();
      }
    });

    test("matches every exported JavaScript scramble vector in SQL", async () => {
      const db = await freshDb();
      try {
        for (const vector of SCRAMBLE_TEST_VECTORS) {
          const result = await db.query<{ scramble: number[] }>(
            "select public._live_scramble_for($1::uuid, $2::uuid) as scramble",
            [vector.questionId, vector.playerId],
          );
          expect(result.rows[0]?.scramble).toEqual(vector.scramble);
        }
      } finally {
        await db.close();
      }
    });

    test("stores one canonical command result, returns it for exact retries, and rejects a reused ID", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const applied = await openRun(db);
        expect(applied).toMatchObject({ code: "applied", applied: true });
        expect(applied.runId).toMatch(/^[0-9a-f-]{36}$/);

        await db.query(
          "update nights set room_revision = room_revision + 1 where id = $1",
          [LIVE.night],
        );
        expect(await openRun(db)).toEqual(applied);

        const conflict = await rpc(
          db,
          "select public.open_night_run($1, $2, null::uuid, 99::bigint) as result",
          [LIVE.night, LIVE.openCommand],
        );
        expect(conflict).toMatchObject({ code: "stale", applied: false });

        const receipt = await db.query<{ status: string; canonical_result: RpcResult }>(
          `select status, canonical_result
             from live_command_receipts
            where night_id = $1 and command_id = $2`,
          [LIVE.night, LIVE.openCommand],
        );
        expect(receipt.rows[0]).toMatchObject({ status: "applied", canonical_result: applied });
      } finally {
        await db.close();
      }
    });

    test("envelopes all six host commands with one fresh winner and canonical replay results", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const call = (sql: string, params: unknown[]) => rpcEnvelope(db, sql, params);

        const opened = await call(
          "select public.open_night_run($1, $2, null::uuid, 0::bigint) as result",
          [LIVE.night, LIVE.openCommand],
        );
        expect(opened).toMatchObject({
          freshlyApplied: true,
          result: { code: "applied", applied: true, eventKind: "night_opened" },
        });
        expect(await call(
          "select public.open_night_run($1, $2, null::uuid, 0::bigint) as result",
          [LIVE.night, LIVE.openCommand],
        )).toEqual({ freshlyApplied: false, result: opened.result });
        expect(await call(
          "select public.open_night_run($1, $2, null::uuid, 99::bigint) as result",
          [LIVE.night, LIVE.openCommand],
        )).toMatchObject({ freshlyApplied: false, result: { code: "stale", applied: false } });

        const rejectedCommand = "50000000-0000-0000-0000-000000000098";
        const rejected = await call(
          "select public.start_live_game($1, $2, $3, 99::bigint) as result",
          [LIVE.game, opened.result.runId, rejectedCommand],
        );
        expect(rejected).toMatchObject({
          freshlyApplied: false,
          result: { code: "stale", applied: false },
        });
        expect(await call(
          "select public.start_live_game($1, $2, $3, 99::bigint) as result",
          [LIVE.game, opened.result.runId, rejectedCommand],
        )).toEqual({ freshlyApplied: false, result: rejected.result });

        const started = await call(
          "select public.start_live_game($1, $2, $3, 1::bigint) as result",
          [LIVE.game, opened.result.runId, LIVE.startCommand],
        );
        const playOpened = await call(
          "select public.open_question_play($1, $2, $3, $4, 2::bigint) as result",
          [LIVE.game, LIVE.question, opened.result.runId, LIVE.revealCommand],
        );
        const finalWindow = await call(
          "select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result",
          [LIVE.game, playOpened.result.playId, opened.result.runId, LIVE.finalCommand],
        );
        const undone = await call(
          "select public.undo_question_play($1, $2, $3, $4, 4::bigint) as result",
          [LIVE.game, playOpened.result.playId, opened.result.runId, LIVE.undoCommand],
        );
        const ended = await call(
          "select public.end_live_game($1, $2, $3, 5::bigint) as result",
          [LIVE.game, opened.result.runId, LIVE.endCommand],
        );

        const winners = [started, playOpened, finalWindow, undone, ended];
        expect(winners.map((entry) => [entry.freshlyApplied, entry.result.eventKind])).toEqual([
          [true, "game_started"],
          [true, "play_opened"],
          [true, "final_window_started"],
          [true, "play_undone"],
          [true, "game_ended"],
        ]);

        const retryCalls: Array<[string, unknown[], RpcEnvelope]> = [
          ["select public.start_live_game($1, $2, $3, 1::bigint) as result",
            [LIVE.game, opened.result.runId, LIVE.startCommand], started],
          ["select public.open_question_play($1, $2, $3, $4, 2::bigint) as result",
            [LIVE.game, LIVE.question, opened.result.runId, LIVE.revealCommand], playOpened],
          ["select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result",
            [LIVE.game, playOpened.result.playId, opened.result.runId, LIVE.finalCommand], finalWindow],
          ["select public.undo_question_play($1, $2, $3, $4, 4::bigint) as result",
            [LIVE.game, playOpened.result.playId, opened.result.runId, LIVE.undoCommand], undone],
          ["select public.end_live_game($1, $2, $3, 5::bigint) as result",
            [LIVE.game, opened.result.runId, LIVE.endCommand], ended],
        ];
        for (const [sql, params, winner] of retryCalls) {
          expect(await call(sql, params)).toEqual({
            freshlyApplied: false,
            result: winner.result,
          });
        }

        const state = await db.query<{
          room_revision: number;
          control_revision: number;
          events: number;
        }>(
          `select n.room_revision, n.control_revision,
                  (select count(*)::int from live_room_events where night_id = n.id) as events
             from nights n where n.id = $1`,
          [LIVE.night],
        );
        expect(state.rows[0]).toEqual({ room_revision: 6, control_revision: 6, events: 6 });

        const receipts = await db.query<{
          has_envelope: boolean;
          event_kind: string | null;
        }>(
          `select canonical_result ? 'freshlyApplied'
                    or canonical_result ? 'result' as has_envelope,
                  canonical_result->>'eventKind' as event_kind
             from live_command_receipts
            where night_id = $1 and status = 'applied'
            order by expected_control_revision`,
          [LIVE.night],
        );
        expect(receipts.rows).toHaveLength(6);
        expect(receipts.rows.every((row) => row.has_envelope === false)).toBe(true);
        expect(receipts.rows.map((row) => row.event_kind)).toEqual([
          "night_opened",
          "game_started",
          "play_opened",
          "final_window_started",
          "play_undone",
          "game_ended",
        ]);
      } finally {
        await db.close();
      }
    });

    test("rejects stale run/control preconditions without changing game state", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        const wrongRun = await startGame(db, "ffffffff-ffff-4fff-8fff-ffffffffffff");
        expect(wrongRun).toMatchObject({ code: "stale", applied: false });

        const wrongControl = await rpc(
          db,
          "select public.start_live_game($1, $2, $3, 0::bigint) as result",
          [LIVE.game, opened.runId, "50000000-0000-0000-0000-000000000099"],
        );
        expect(wrongControl).toMatchObject({ code: "stale", applied: false });
        const game = await db.query<{ state: string }>("select state from games where id = $1", [LIVE.game]);
        expect(game.rows[0]?.state).toBe("ready");
      } finally {
        await db.close();
      }
    });

    test("persists a rejected command result so an exact retry cannot become applied later", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        await db.query("update games set state = 'draft' where id = $1", [LIVE.game]);
        const rejected = await startGame(db, opened.runId as string);
        expect(rejected).toMatchObject({ code: "invalid_state", applied: false });

        await db.query("update games set state = 'ready' where id = $1", [LIVE.game]);
        expect(await startGame(db, opened.runId as string)).toEqual(rejected);
        const game = await db.query<{ state: string }>("select state from games where id = $1", [LIVE.game]);
        expect(game.rows[0]?.state).toBe("ready");
      } finally {
        await db.close();
      }
    });

    test("keeps every stale host command rejected after the room reaches its requested revision", async () => {
      const db = await freshDb();
      const command = (suffix: string) => `50000000-0000-0000-0000-000000000${suffix}`;
      try {
        await seedLiveFixture(db);

        const staleOpen = await rpc(
          db,
          "select public.open_night_run($1, $2, null::uuid, 1::bigint) as result",
          [LIVE.night, command("101")],
        );
        expect(staleOpen).toMatchObject({ code: "stale", applied: false });
        const opened = await openRun(db);
        expect(await rpc(
          db,
          "select public.open_night_run($1, $2, null::uuid, 1::bigint) as result",
          [LIVE.night, command("101")],
        )).toEqual(staleOpen);

        const staleStart = await rpc(
          db,
          "select public.start_live_game($1, $2, $3, 2::bigint) as result",
          [LIVE.game, opened.runId, command("102")],
        );
        expect(staleStart).toMatchObject({ code: "stale", applied: false });
        await startGame(db, opened.runId as string);
        expect(await rpc(
          db,
          "select public.start_live_game($1, $2, $3, 2::bigint) as result",
          [LIVE.game, opened.runId, command("102")],
        )).toEqual(staleStart);

        const staleOpenPlay = await rpc(
          db,
          "select public.open_question_play($1, $2, $3, $4, 3::bigint) as result",
          [LIVE.game, LIVE.question, opened.runId, command("103")],
        );
        expect(staleOpenPlay).toMatchObject({ code: "stale", applied: false });
        const play = await openPlay(db, opened.runId as string);
        expect(await rpc(
          db,
          "select public.open_question_play($1, $2, $3, $4, 3::bigint) as result",
          [LIVE.game, LIVE.question, opened.runId, command("103")],
        )).toEqual(staleOpenPlay);

        const staleFinal = await rpc(
          db,
          "select public.begin_question_play_final_window($1, $2, $3, $4, 4::bigint) as result",
          [LIVE.game, play.playId, opened.runId, command("104")],
        );
        expect(staleFinal).toMatchObject({ code: "stale", applied: false });
        await rpc(
          db,
          "select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result",
          [LIVE.game, play.playId, opened.runId, LIVE.finalCommand],
        );
        expect(await rpc(
          db,
          "select public.begin_question_play_final_window($1, $2, $3, $4, 4::bigint) as result",
          [LIVE.game, play.playId, opened.runId, command("104")],
        )).toEqual(staleFinal);

        const staleUndo = await rpc(
          db,
          "select public.undo_question_play($1, $2, $3, $4, 5::bigint) as result",
          [LIVE.game, play.playId, opened.runId, command("105")],
        );
        expect(staleUndo).toMatchObject({ code: "stale", applied: false });
        await rpc(
          db,
          "select public.undo_question_play($1, $2, $3, $4, 4::bigint) as result",
          [LIVE.game, play.playId, opened.runId, LIVE.undoCommand],
        );
        expect(await rpc(
          db,
          "select public.undo_question_play($1, $2, $3, $4, 5::bigint) as result",
          [LIVE.game, play.playId, opened.runId, command("105")],
        )).toEqual(staleUndo);

        const staleEnd = await rpc(
          db,
          "select public.end_live_game($1, $2, $3, 6::bigint) as result",
          [LIVE.game, opened.runId, command("106")],
        );
        expect(staleEnd).toMatchObject({ code: "stale", applied: false });
        await rpc(
          db,
          "select public.end_live_game($1, $2, $3, 5::bigint) as result",
          [LIVE.game, opened.runId, LIVE.endCommand],
        );
        expect(await rpc(
          db,
          "select public.end_live_game($1, $2, $3, 6::bigint) as result",
          [LIVE.game, opened.runId, command("106")],
        )).toEqual(staleEnd);

        const receipts = await db.query<{ status: string; count: number }>(
          `select status, count(*)::int as count
             from live_command_receipts
            where command_id in ($1, $2, $3, $4, $5, $6)
            group by status`,
          [
            command("101"), command("102"), command("103"),
            command("104"), command("105"), command("106"),
          ],
        );
        expect(receipts.rows).toEqual([{ status: "rejected", count: 6 }]);
      } finally {
        await db.close();
      }
    });

    test("opens a play with frozen eligibility, database deadlines, and monotonic control revisions", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        expect(await startGame(db, opened.runId as string)).toMatchObject({
          code: "applied",
          controlRevision: 2,
        });
        const play = await openPlay(db, opened.runId as string);
        expect(play).toMatchObject({ code: "applied", controlRevision: 3 });

        const row = await db.query<{
          status: string;
          eligible_count: number;
          main_ms: number;
          final_ms: number;
          played_at: string | null;
        }>(
          `select qp.status, qp.eligible_count,
                  round(extract(epoch from (qp.main_zero_at - qp.opened_at)) * 1000)::integer as main_ms,
                  round(extract(epoch from (qp.final_window_ends_at - qp.main_zero_at)) * 1000)::integer as final_ms,
                  q.played_at
             from question_plays qp
             join questions q on q.id = qp.question_id
            where qp.id = $1`,
          [play.playId],
        );
        expect(row.rows[0]).toMatchObject({
          status: "accepting",
          eligible_count: 2,
          main_ms: 30_000,
          final_ms: 2_000,
        });
        expect(row.rows[0]?.played_at).not.toBeNull();

        const eligible = await db.query<{ player_id: string }>(
          "select player_id from question_play_eligibility where play_id = $1 order by player_id",
          [play.playId],
        );
        expect(eligible.rows.map((entry) => entry.player_id)).toEqual([LIVE.playerA, LIVE.playerB]);
      } finally {
        await db.close();
      }
    });

    test("derives canonical choice from identity, preserves the first answer, and increments only room revision", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        const started = await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);
        const visibleSlot = 2;
        const expectedCanonical = SCRAMBLE_TEST_VECTORS.find(
          (vector) => vector.questionId === LIVE.question && vector.playerId === LIVE.playerA,
        )?.scramble[visibleSlot - 1];

        const confirmed = await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, $5::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA, visibleSlot],
        );
        expect(confirmed).toMatchObject({
          code: "confirmed",
          confirmedSlot: visibleSlot,
          duplicate: false,
          roomRevision: 4,
          controlRevision: 3,
        });
        expect(await startGame(db, opened.runId as string)).toEqual(started);

        const answer = await db.query<{
          canonical_index: number;
          submission_id: string;
        }>(
          "select canonical_index, submission_id from question_play_answers where play_id = $1 and player_id = $2",
          [play.playId, LIVE.playerA],
        );
        expect(answer.rows[0]).toEqual({
          canonical_index: expectedCanonical,
          submission_id: LIVE.submissionA,
        });

        await db.query(
          `update question_plays
              set opened_at = now() - interval '40 seconds',
                  main_zero_at = now() - interval '10 seconds',
                  final_window_ends_at = now() - interval '8 seconds'
            where id = $1`,
          [play.playId],
        );
        const duplicate = await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 4::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, "60000000-0000-0000-0000-000000000099"],
        );
        expect(duplicate).toEqual(confirmed);
      } finally {
        await db.close();
      }
    });

    test("marks only the accepted answer transition fresh across rate limits and duplicates", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);

        await db.query(
          `insert into question_play_attempt_windows (
             play_id, player_id, window_started_at, attempt_count
           ) values ($1, $2, now(), 10)`,
          [play.playId, LIVE.playerA],
        );
        const rateLimited = await rpcEnvelope(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 2::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        );
        expect(rateLimited).toMatchObject({
          freshlyApplied: false,
          result: { code: "retry_later", retryAfterMs: expect.any(Number) },
        });
        await db.query("delete from question_play_attempt_windows where play_id = $1", [play.playId]);

        const winner = await rpcEnvelope(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 2::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        );
        expect(winner).toMatchObject({
          freshlyApplied: true,
          result: {
            code: "confirmed",
            confirmedSlot: 2,
            eventKind: "answer_progress",
          },
        });

        const exactRetry = await rpcEnvelope(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 2::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        );
        expect(exactRetry).toEqual({ freshlyApplied: false, result: winner.result });

        const conflictingRetry = await rpcEnvelope(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 4::smallint) as result",
          [
            play.playId,
            opened.runId,
            LIVE.deviceA,
            "60000000-0000-0000-0000-000000000099",
          ],
        );
        expect(conflictingRetry).toEqual({
          freshlyApplied: false,
          result: winner.result,
        });

        await rpcEnvelope(
          db,
          "select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result",
          [LIVE.game, play.playId, opened.runId, LIVE.finalCommand],
        );
        await rpcEnvelope(
          db,
          "select public.undo_question_play($1, $2, $3, $4, 4::bigint) as result",
          [LIVE.game, play.playId, opened.runId, LIVE.undoCommand],
        );
        await rpcEnvelope(
          db,
          "select public.end_live_game($1, $2, $3, 5::bigint) as result",
          [LIVE.game, opened.runId, LIVE.endCommand],
        );
        const afterTransitions = await rpcEnvelope(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 2::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        );
        expect(afterTransitions).toEqual({ freshlyApplied: false, result: winner.result });

        const stored = await db.query<{ canonical_result: RpcResult | null }>(
          `select canonical_result
             from question_play_answers
            where play_id = $1 and player_id = $2`,
          [play.playId, LIVE.playerA],
        );
        expect(stored.rows).toEqual([{ canonical_result: winner.result }]);

        const state = await db.query<{
          room_revision: number;
          control_revision: number;
          answers: number;
          answer_events: number;
        }>(
          `select n.room_revision, n.control_revision,
                  (select count(*)::int from question_play_answers where play_id = $2) as answers,
                  (select count(*)::int from live_room_events
                    where play_id = $2 and kind = 'answer_progress') as answer_events
             from nights n where n.id = $1`,
          [LIVE.night, play.playId],
        );
        expect(state.rows[0]).toEqual({
          room_revision: 7,
          control_revision: 6,
          answers: 1,
          answer_events: 1,
        });
      } finally {
        await db.close();
      }
    });

    test("parses the real confirmed-answer winner and canonical replay at the shared seam", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        const runId = opened.runId as string;
        await startGame(db, runId);
        const play = await openPlay(db, runId);

        const winner = await rpcEnvelope(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 2::smallint) as result",
          [play.playId, runId, LIVE.deviceA, LIVE.submissionA],
        );
        const replay = await rpcEnvelope(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 2::smallint) as result",
          [play.playId, runId, LIVE.deviceA, LIVE.submissionA],
        );

        const parsedWinner = parseLiveAnswerRpcEnvelope(winner);
        const parsedReplay = parseLiveAnswerRpcEnvelope(replay);
        expect(parsedWinner).toMatchObject({
          freshlyApplied: true,
          freshness: "transaction_winner",
          result: { code: "confirmed", runId },
        });
        expect(parsedReplay).toMatchObject({
          freshlyApplied: false,
          freshness: "replay",
          result: { code: "confirmed", runId },
        });
        expect(parsedReplay?.result).toEqual(parsedWinner?.result);
        expect(replay.result).toEqual(winner.result);

        const missingRunIdResult = { ...winner.result };
        delete missingRunIdResult.runId;
        expect(parseLiveAnswerRpcEnvelope({
          ...winner,
          result: missingRunIdResult,
        })).toBeNull();

        const stored = await db.query<{ canonical_result: RpcResult }>(
          `select canonical_result
             from question_play_answers
            where play_id = $1 and player_id = $2`,
          [play.playId, LIVE.playerA],
        );
        expect(stored.rows).toEqual([{ canonical_result: winner.result }]);

        const state = await db.query<{
          room_revision: number;
          control_revision: number;
          answers: number;
          answer_events: number;
        }>(
          `select n.room_revision, n.control_revision,
                  (select count(*)::int from question_play_answers where play_id = $2) as answers,
                  (select count(*)::int from live_room_events
                    where play_id = $2 and kind = 'answer_progress') as answer_events
             from nights n where n.id = $1`,
          [LIVE.night, play.playId],
        );
        expect(state.rows[0]).toEqual({
          room_revision: 4,
          control_revision: 3,
          answers: 1,
          answer_events: 1,
        });
      } finally {
        await db.close();
      }
    });

    test("fails closed when a pre-canonical answer row is retried", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db, 1);
        const opened = await openRun(db);
        await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);
        await db.query(
          `insert into question_play_answers (
             play_id, player_id, submission_id, visible_slot, canonical_index,
             received_at, locked_at, ms_to_lock
           ) values ($1, $2, $3, 2, 0, now(), now(), 1)`,
          [play.playId, LIVE.playerA, LIVE.submissionA],
        );

        const retry = await rpcEnvelope(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 2::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        );
        expect(retry).toEqual({
          freshlyApplied: false,
          result: { code: "retry_later", retryAfterMs: 100 },
        });

        const state = await db.query<{
          room_revision: number;
          control_revision: number;
          answer_events: number;
        }>(
          `select n.room_revision, n.control_revision,
                  (select count(*)::int from live_room_events
                    where play_id = $2 and kind = 'answer_progress') as answer_events
             from nights n where n.id = $1`,
          [LIVE.night, play.playId],
        );
        expect(state.rows[0]).toEqual({
          room_revision: 3,
          control_revision: 3,
          answer_events: 0,
        });
      } finally {
        await db.close();
      }
    });

    test("rejects invalid, ineligible, late, and rate-limited first answers with typed results", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db, 1);
        const opened = await openRun(db);
        await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);

        expect(await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 1::smallint) as result",
          [play.playId, opened.runId, "ffffffff-ffff-4fff-8fff-ffffffffffff", LIVE.submissionA],
        )).toMatchObject({ code: "identity_invalid" });
        expect(await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 1::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceB, LIVE.submissionA],
        )).toMatchObject({ code: "not_eligible" });

        await db.query(
          `insert into question_play_attempt_windows (
             play_id, player_id, window_started_at, attempt_count
           ) values ($1, $2, now(), 10)`,
          [play.playId, LIVE.playerA],
        );
        expect(await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 1::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        )).toMatchObject({ code: "retry_later", retryAfterMs: expect.any(Number) });

        await db.query("delete from question_play_attempt_windows where play_id = $1", [play.playId]);
        await db.query(
          `update question_plays
              set opened_at = now() - interval '40 seconds',
                  main_zero_at = now() - interval '10 seconds',
                  final_window_ends_at = now()
            where id = $1`,
          [play.playId],
        );
        expect(await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 1::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        )).toMatchObject({ code: "deadline_passed" });
      } finally {
        await db.close();
      }
    });

    test("enters all-in hold only after every eligible answer and never for zero eligible players", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);
        await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 3::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        );
        await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 1::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceB, LIVE.submissionB],
        );
        const held = await db.query<{
          status: string;
          confirmed_count: number;
          minimum_hold_ms: number;
        }>(
          `select status, confirmed_count,
                  round(extract(epoch from (finalize_at - opened_at)) * 1000)::integer as minimum_hold_ms
             from question_plays where id = $1`,
          [play.playId],
        );
        expect(held.rows[0]).toMatchObject({
          status: "all_in_hold",
          confirmed_count: 2,
        });
        expect(held.rows[0]?.minimum_hold_ms).toBeGreaterThanOrEqual(2_000);
      } finally {
        await db.close();
      }

      const zeroDb = await freshDb();
      try {
        await seedLiveFixture(zeroDb, 0);
        const opened = await openRun(zeroDb);
        await startGame(zeroDb, opened.runId as string);
        const play = await openPlay(zeroDb, opened.runId as string);
        const row = await zeroDb.query<{ status: string; eligible_count: number }>(
          "select status, eligible_count from question_plays where id = $1",
          [play.playId],
        );
        expect(row.rows[0]).toEqual({ status: "accepting", eligible_count: 0 });
      } finally {
        await zeroDb.close();
      }
    });

    test("bases all-in hold on the latest accepted receipt, not the transaction processed last", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);
        const playRow = await db.query<{ opened_at: string }>(
          "select opened_at from question_plays where id = $1",
          [play.playId],
        );

        await db.query(
          `insert into question_play_answers (
             play_id, player_id, submission_id, visible_slot, canonical_index,
             received_at, locked_at, ms_to_lock
           ) values (
             $1, $2, $3, 1, 0,
             clock_timestamp() + interval '1 second',
             clock_timestamp() + interval '1 second', 1000
           )`,
          [play.playId, LIVE.playerB, LIVE.submissionB],
        );
        await db.query("update question_plays set confirmed_count = 1 where id = $1", [play.playId]);

        await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 1::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        );
        const timing = await db.query<{
          status: string;
          latest_hold_ms: number;
          opened_hold_ms: number;
        }>(
          `select qp.status,
                  round(extract(epoch from (
                    qp.finalize_at - max(qpa.received_at)
                  )) * 1000)::integer as latest_hold_ms,
                  round(extract(epoch from (
                    qp.finalize_at - qp.opened_at
                  )) * 1000)::integer as opened_hold_ms
             from question_plays qp
             join question_play_answers qpa on qpa.play_id = qp.id
            where qp.id = $1
            group by qp.id`,
          [play.playId],
        );
        expect(timing.rows[0]).toMatchObject({
          status: "all_in_hold",
          latest_hold_ms: 1_200,
        });
        expect(timing.rows[0]?.opened_hold_ms).toBeGreaterThanOrEqual(2_000);
        expect(playRow.rows[0]?.opened_at).toBeDefined();
      } finally {
        await db.close();
      }
    });

    test("holds an early final window steady, rejects answers at its exact end, and resolves overdue reconnect once", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);
        const finalWindow = await rpc(
          db,
          "select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result",
          [LIVE.game, play.playId, opened.runId, LIVE.finalCommand],
        );
        expect(finalWindow).toMatchObject({ code: "applied", controlRevision: 4 });

        const before = await db.query<{ final_window_ends_at: string }>(
          "select final_window_ends_at from question_plays where id = $1",
          [play.playId],
        );
        await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 3::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        );
        const after = await db.query<{ final_window_ends_at: string }>(
          "select final_window_ends_at from question_plays where id = $1",
          [play.playId],
        );
        expect(after.rows[0]?.final_window_ends_at).toEqual(before.rows[0]?.final_window_ends_at);

        await db.query(
          `update question_plays
              set opened_at = now() - interval '40 seconds',
                  main_zero_at = now() - interval '10 seconds',
                  final_window_starts_at = now() - interval '2 seconds',
                  final_window_ends_at = now(),
                  finalize_at = now()
            where id = $1`,
          [play.playId],
        );
        expect(await rpc(
          db,
          "select public.submit_question_play_answer($1, $2, $3, $4, 1::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceB, LIVE.submissionB],
        )).toMatchObject({ code: "deadline_passed" });

        const resolved = await rpc(
          db,
          "select public.finalize_current_play_if_due($1, $2, $3) as result",
          ["ATOMIC", opened.runId, play.playId],
        );
        expect(resolved).toMatchObject({ code: "resolved", applied: true });
        const canonical = await db.query<{
          status: string;
          finished_at: string | null;
          answered: number;
          awarded: number;
        }>(
          `select qp.status, q.finished_at,
                  count(qpa.*)::int as answered,
                  coalesce(sum(qpa.awarded_points), 0)::int as awarded
             from question_plays qp
             join questions q on q.id = qp.question_id
             left join question_play_answers qpa on qpa.play_id = qp.id
            where qp.id = $1
            group by qp.status, q.finished_at`,
          [play.playId],
        );
        expect(canonical.rows[0]).toMatchObject({
          status: "resolved",
          answered: 1,
          awarded: 500,
        });
        expect(canonical.rows[0]?.finished_at).not.toBeNull();

        const revisions = await db.query<{ room_revision: number; control_revision: number }>(
          "select room_revision, control_revision from nights where id = $1",
          [LIVE.night],
        );
        const again = await rpcEnvelope(
          db,
          "select public.finalize_current_play_if_due($1, $2, $3) as result",
          ["ATOMIC", opened.runId, play.playId],
        );
        expect(again).toEqual({ freshlyApplied: false, result: resolved });
        const revisionsAfter = await db.query<{ room_revision: number; control_revision: number }>(
          "select room_revision, control_revision from nights where id = $1",
          [LIVE.night],
        );
        expect(revisionsAfter.rows[0]).toEqual(revisions.rows[0]);
      } finally {
        await db.close();
      }
    });

    test("marks only the due finalizer fresh and bypasses rate limits for resolved retries", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);

        const notDue = await rpcEnvelope(
          db,
          "select public.finalize_current_play_if_due($1, $2, $3) as result",
          ["ATOMIC", opened.runId, play.playId],
        );
        expect(notDue).toMatchObject({
          freshlyApplied: false,
          result: { code: "not_due", applied: false },
        });

        await db.query(
          "update play_finalize_attempt_windows set attempt_count = 120 where play_id = $1",
          [play.playId],
        );
        const rateLimited = await rpcEnvelope(
          db,
          "select public.finalize_current_play_if_due($1, $2, $3) as result",
          ["ATOMIC", opened.runId, play.playId],
        );
        expect(rateLimited).toMatchObject({
          freshlyApplied: false,
          result: { code: "retry_later", retryAfterMs: expect.any(Number) },
        });

        await db.query("delete from play_finalize_attempt_windows where play_id = $1", [play.playId]);
        await db.query(
          `update question_plays
              set opened_at = now() - interval '40 seconds',
                  main_zero_at = now() - interval '10 seconds',
                  final_window_ends_at = now() - interval '8 seconds'
            where id = $1`,
          [play.playId],
        );
        const winner = await rpcEnvelope(
          db,
          "select public.finalize_current_play_if_due($1, $2, $3) as result",
          ["ATOMIC", opened.runId, play.playId],
        );
        expect(winner).toMatchObject({
          freshlyApplied: true,
          result: {
            code: "resolved",
            applied: true,
            eventKind: "play_resolved",
          },
        });

        const ended = await rpcEnvelope(
          db,
          "select public.end_live_game($1, $2, $3, 4::bigint) as result",
          [
            LIVE.game,
            opened.runId,
            "50000000-0000-0000-0000-000000000097",
          ],
        );
        expect(ended).toMatchObject({ freshlyApplied: true, result: { code: "applied" } });

        await db.query(
          `insert into play_finalize_attempt_windows (play_id, window_started_at, attempt_count)
           values ($1, now(), 120)
           on conflict (play_id) do update set window_started_at = now(), attempt_count = 120`,
          [play.playId],
        );
        const replay = await rpcEnvelope(
          db,
          "select public.finalize_current_play_if_due($1, $2, $3) as result",
          ["ATOMIC", opened.runId, play.playId],
        );
        expect(replay).toEqual({ freshlyApplied: false, result: winner.result });

        const state = await db.query<{
          room_revision: number;
          control_revision: number;
          resolved_events: number;
        }>(
          `select n.room_revision, n.control_revision,
                  (select count(*)::int from live_room_events
                    where play_id = $2 and kind = 'play_resolved') as resolved_events
             from nights n where n.id = $1`,
          [LIVE.night, play.playId],
        );
        expect(state.rows[0]).toEqual({
          room_revision: 5,
          control_revision: 5,
          resolved_events: 1,
        });
      } finally {
        await db.close();
      }
    });

    test("preserves or resolves the stored final deadline when Show answer arrives at or after main zero", async () => {
      const betweenDb = await freshDb();
      try {
        await seedLiveFixture(betweenDb);
        const opened = await openRun(betweenDb);
        await startGame(betweenDb, opened.runId as string);
        const play = await openPlay(betweenDb, opened.runId as string);
        await betweenDb.query(
          `update question_plays
              set opened_at = now() - interval '31 seconds',
                  main_zero_at = now() - interval '1 second',
                  final_window_ends_at = now() + interval '1 second'
            where id = $1`,
          [play.playId],
        );
        const before = await betweenDb.query<{
          main_zero_at: string;
          final_window_ends_at: string;
        }>(
          "select main_zero_at, final_window_ends_at from question_plays where id = $1",
          [play.playId],
        );
        expect(await rpc(
          betweenDb,
          "select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result",
          [LIVE.game, play.playId, opened.runId, LIVE.finalCommand],
        )).toMatchObject({ code: "applied", applied: true });
        const after = await betweenDb.query<{
          status: string;
          final_window_starts_at: string;
          final_window_ends_at: string;
        }>(
          "select status, final_window_starts_at, final_window_ends_at from question_plays where id = $1",
          [play.playId],
        );
        expect(after.rows[0]).toMatchObject({ status: "final_window" });
        expect(after.rows[0]?.final_window_starts_at).toEqual(before.rows[0]?.main_zero_at);
        expect(after.rows[0]?.final_window_ends_at).toEqual(before.rows[0]?.final_window_ends_at);
      } finally {
        await betweenDb.close();
      }

      const overdueDb = await freshDb();
      try {
        await seedLiveFixture(overdueDb);
        const opened = await openRun(overdueDb);
        await startGame(overdueDb, opened.runId as string);
        const play = await openPlay(overdueDb, opened.runId as string);
        await overdueDb.query(
          `update question_plays
              set opened_at = now() - interval '40 seconds',
                  main_zero_at = now() - interval '10 seconds',
                  final_window_ends_at = now() - interval '8 seconds'
            where id = $1`,
          [play.playId],
        );
        expect(await rpc(
          overdueDb,
          "select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result",
          [LIVE.game, play.playId, opened.runId, LIVE.finalCommand],
        )).toMatchObject({ code: "resolved", applied: true });
        expect(await rpc(
          overdueDb,
          "select public.submit_question_play_answer($1, $2, $3, $4, 1::smallint) as result",
          [play.playId, opened.runId, LIVE.deviceA, LIVE.submissionA],
        )).toMatchObject({ code: "deadline_passed" });
        const row = await overdueDb.query<{
          status: string;
          final_window_ends_at: string;
          finished_at: string | null;
        }>(
          `select qp.status, qp.final_window_ends_at, q.finished_at
             from question_plays qp
             join questions q on q.id = qp.question_id
            where qp.id = $1`,
          [play.playId],
        );
        expect(row.rows[0]).toMatchObject({ status: "resolved" });
        expect(row.rows[0]?.finished_at).not.toBeNull();
      } finally {
        await overdueDb.close();
      }
    });

    test("awards speed bonus only before the final-window boundary", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);
        await rpc(
          db,
          "select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result",
          [LIVE.game, play.playId, opened.runId, LIVE.finalCommand],
        );
        const window = await db.query<{ starts_at: string }>(
          "select final_window_starts_at as starts_at from question_plays where id = $1",
          [play.playId],
        );
        await db.query(
          `insert into question_play_answers (
             play_id, player_id, submission_id, visible_slot, canonical_index,
             received_at, locked_at, ms_to_lock
           ) values
             ($1, $2, $4, 3, 2, $6::timestamptz - interval '1 millisecond', $6, 1000),
             ($1, $3, $5, 3, 2, $6, $6, 1000)`,
          [
            play.playId,
            LIVE.playerA,
            LIVE.playerB,
            LIVE.submissionA,
            LIVE.submissionB,
            window.rows[0]?.starts_at,
          ],
        );
        await db.query(
          `update question_plays
              set confirmed_count = 2,
                  opened_at = $2::timestamptz - interval '3 seconds',
                  final_window_ends_at = $2::timestamptz + interval '1 millisecond',
                  finalize_at = $2::timestamptz + interval '1 millisecond'
            where id = $1`,
          [play.playId, window.rows[0]?.starts_at],
        );
        await rpc(
          db,
          "select public.finalize_current_play_if_due($1, $2, $3) as result",
          ["ATOMIC", opened.runId, play.playId],
        );
        const awards = await db.query<{ player_id: string; awarded_points: number }>(
          `select player_id, awarded_points
             from question_play_answers
            where play_id = $1 order by player_id`,
          [play.playId],
        );
        expect(awards.rows).toEqual([
          { player_id: LIVE.playerA, awarded_points: 550 },
          { player_id: LIVE.playerB, awarded_points: 500 },
        ]);
      } finally {
        await db.close();
      }
    });

    test("rejects undo at the exact two-second boundary but allows one millisecond before", async () => {
      const db = await freshDb();
      try {
        const result = await db.query<{ before: boolean; boundary: boolean }>(`
          select
            public._live_undo_allowed(
              '2026-01-01T00:00:00Z'::timestamptz,
              '2026-01-01T00:00:01.999Z'::timestamptz
            ) as before,
            public._live_undo_allowed(
              '2026-01-01T00:00:00Z'::timestamptz,
              '2026-01-01T00:00:02Z'::timestamptz
            ) as boundary
        `);
        expect(result.rows[0]).toEqual({ before: true, boundary: false });
      } finally {
        await db.close();
      }
    });

    test("enters the fixed final window at main zero without resolving before its database end", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);
        await db.query(
          `update question_plays
              set opened_at = now() - interval '31 seconds',
                  main_zero_at = now() - interval '1 second',
                  final_window_ends_at = now() + interval '1 second'
            where id = $1`,
          [play.playId],
        );

        const entered = await rpcEnvelope(
          db,
          "select public.finalize_current_play_if_due($1, $2, $3) as result",
          ["ATOMIC", opened.runId, play.playId],
        );
        expect(entered).toMatchObject({
          freshlyApplied: true,
          result: {
            code: "final_window",
            applied: true,
            eventKind: "final_window_started",
          },
        });
        expect(await rpcEnvelope(
          db,
          "select public.finalize_current_play_if_due($1, $2, $3) as result",
          ["ATOMIC", opened.runId, play.playId],
        )).toMatchObject({
          freshlyApplied: false,
          result: { code: "not_due", applied: false },
        });

        const row = await db.query<{
          status: string;
          final_window_starts_at: string | null;
          finished_at: string | null;
        }>(
          `select qp.status, qp.final_window_starts_at, q.finished_at
             from question_plays qp
             join questions q on q.id = qp.question_id
            where qp.id = $1`,
          [play.playId],
        );
        expect(row.rows[0]).toMatchObject({ status: "final_window", finished_at: null });
        expect(row.rows[0]?.final_window_starts_at).not.toBeNull();
      } finally {
        await db.close();
      }
    });

    test("rate-limits public due checks and supports undo then game end through atomic RPCs", async () => {
      const db = await freshDb();
      try {
        await seedLiveFixture(db);
        const opened = await openRun(db);
        await startGame(db, opened.runId as string);
        const play = await openPlay(db, opened.runId as string);
        await db.query(
          `insert into play_finalize_attempt_windows (
             play_id, window_started_at, attempt_count
           ) values ($1, now(), 120)`,
          [play.playId],
        );
        expect(await rpc(
          db,
          "select public.finalize_current_play_if_due($1, $2, $3) as result",
          ["ATOMIC", opened.runId, play.playId],
        )).toMatchObject({ code: "retry_later", retryAfterMs: expect.any(Number) });

        const undone = await rpc(
          db,
          "select public.undo_question_play($1, $2, $3, $4, 3::bigint) as result",
          [LIVE.game, play.playId, opened.runId, LIVE.undoCommand],
        );
        expect(undone).toMatchObject({ code: "applied", controlRevision: 4 });
        const question = await db.query<{ played_at: string | null; finished_at: string | null }>(
          "select played_at, finished_at from questions where id = $1",
          [LIVE.question],
        );
        expect(question.rows[0]).toEqual({ played_at: null, finished_at: null });

        const ended = await rpc(
          db,
          "select public.end_live_game($1, $2, $3, 4::bigint) as result",
          [LIVE.game, opened.runId, LIVE.endCommand],
        );
        expect(ended).toMatchObject({ code: "applied", controlRevision: 5 });
        const game = await db.query<{ state: string; ended_at: string | null }>(
          "select state, ended_at from games where id = $1",
          [LIVE.game],
        );
        expect(game.rows[0]?.state).toBe("done");
        expect(game.rows[0]?.ended_at).not.toBeNull();
      } finally {
        await db.close();
      }
    });
  });
});
