import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

type Json = Record<string, unknown>;
type Envelope = { freshlyApplied: boolean; result: Json };
type Fixture = {
  hostId: string;
  nightId: string;
  gameId: string;
  questionId: string;
  roomCode: string;
  players: Array<{ id: string; deviceId: string }>;
};

const databaseUrl = process.env.TR1VIA_RACE_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Never let this harness point at a hosted Supabase project by mistake.
const localDatabaseHosts = new Set(["127.0.0.1", "localhost", "::1"]);
const target = new URL(databaseUrl);
if (!localDatabaseHosts.has(target.hostname)) {
  throw new Error("TR1VIA_RACE_DATABASE_URL must target local disposable PostgreSQL");
}

let admin: Client;

function uuid(): string {
  return crypto.randomUUID();
}

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function rpc(client: Client, sql: string, values: unknown[]): Promise<Envelope> {
  const result = await client.query<{ result: Envelope }>(sql, values);
  return result.rows[0]?.result ?? { freshlyApplied: false, result: { code: "missing" } };
}

async function concurrently<T>(commands: Array<(client: Client) => Promise<T>>): Promise<T[]> {
  const clients = await Promise.all(commands.map(() => connect()));
  try {
    return await Promise.all(commands.map((command, index) => command(clients[index])));
  } finally {
    await Promise.all(clients.map((client) => client.end()));
  }
}

async function createFixture(playerCount = 2): Promise<Fixture> {
  const hostUser = uuid();
  const hostId = uuid();
  const nightId = uuid();
  const gameId = uuid();
  const categoryId = uuid();
  const questionId = uuid();
  const roomCode = `R${uuid().replaceAll("-", "").slice(0, 5).toUpperCase()}`;
  await admin.query("insert into auth.users (id) values ($1)", [hostUser]);
  await admin.query("insert into hosts (id, user_id, display_name) values ($1, $2, 'Race host')", [hostId, hostUser]);
  await admin.query(
    `insert into host_answer_engine_settings (host_id, release_enabled, preferred_engine)
     values ($1, true, 'resilient_v1')`,
    [hostId],
  );
  await admin.query(
    "insert into nights (id, host_id, venue_name, room_code) values ($1, $2, 'Race venue', $3)",
    [nightId, hostId, roomCode],
  );
  await admin.query("insert into games (id, night_id, game_no, state) values ($1, $2, 1, 'ready')", [gameId, nightId]);
  await admin.query(
    "insert into categories (id, game_id, name, topic, position, state) values ($1, $2, 'Race', 'Race', 0, 'ready')",
    [categoryId, gameId],
  );
  await admin.query(
    `insert into questions (id, category_id, point_value, prompt, options, correct_index, is_picked)
     values ($1, $2, 100, 'Race question?', '["A","B","C","D"]'::jsonb, 0, true)`,
    [questionId, categoryId],
  );
  const players = Array.from({ length: playerCount }, () => ({ id: uuid(), deviceId: uuid() }));
  for (const [index, player] of players.entries()) {
    await admin.query(
      "insert into players (id, night_id, device_id, display_name) values ($1, $2, $3, $4)",
      [player.id, nightId, player.deviceId, `Player ${index + 1}`],
    );
    await admin.query("insert into game_participations (game_id, player_id) values ($1, $2)", [gameId, player.id]);
  }
  return { hostId, nightId, gameId, questionId, roomCode, players };
}

async function openRun(fixture: Fixture): Promise<string> {
  const opened = await rpc(
    admin,
    "select public.open_night_run($1, $2, null::uuid, 0::bigint) as result",
    [fixture.nightId, uuid()],
  );
  expect(opened.result).toMatchObject({ code: "applied", runId: expect.any(String) });
  return opened.result.runId as string;
}

async function startGame(fixture: Fixture, runId: string, revision = 1): Promise<void> {
  const started = await rpc(
    admin,
    "select public.start_live_game($1, $2, $3, $4::bigint) as result",
    [fixture.gameId, runId, uuid(), revision],
  );
  expect(started.result).toMatchObject({ code: "applied", eventKind: "game_started" });
}

async function openPlay(fixture: Fixture, runId: string, revision = 2): Promise<string> {
  const opened = await rpc(
    admin,
    "select public.open_question_play($1, $2, $3, $4, $5::bigint) as result",
    [fixture.gameId, fixture.questionId, runId, uuid(), revision],
  );
  expect(opened.result).toMatchObject({ code: "applied", playId: expect.any(String) });
  return opened.result.playId as string;
}

async function readyPlay(playerCount = 2): Promise<{ fixture: Fixture; runId: string; playId: string }> {
  const fixture = await createFixture(playerCount);
  const runId = await openRun(fixture);
  await startGame(fixture, runId);
  return { fixture, runId, playId: await openPlay(fixture, runId) };
}

async function answer(client: Client, playId: string, runId: string, deviceId: string, submissionId = uuid(), slot = 1): Promise<Envelope> {
  return rpc(
    client,
    "select public.submit_question_play_answer($1, $2, $3, $4, $5::smallint) as result",
    [playId, runId, deviceId, submissionId, slot],
  );
}

async function removeFixture(fixture: Fixture): Promise<void> {
  await admin.query("delete from hosts where id = $1", [fixture.hostId]);
}

beforeAll(async () => {
  admin = await connect();
  await admin.query("select 1");
});

afterAll(async () => {
  await admin?.end();
});

describe("authoritative answer engine PostgreSQL races", () => {
  test("simultaneous last answers produce one all-in hold after exactly two canonical answers", async () => {
    const { fixture, runId, playId } = await readyPlay(2);
    try {
      const results = await concurrently(fixture.players.map((player) => (client) => answer(client, playId, runId, player.deviceId)));
      expect(results.map((entry) => entry.result.code)).toEqual(["confirmed", "confirmed"]);
      const state = await admin.query<{ confirmed_count: number; eligible_count: number; status: string; answers: number }>(
        `select qp.confirmed_count, qp.eligible_count, qp.status,
                (select count(*)::int from question_play_answers where play_id = qp.id) as answers
           from question_plays qp where id = $1`, [playId],
      );
      expect(state.rows[0]).toMatchObject({ confirmed_count: 2, eligible_count: 2, status: "all_in_hold", answers: 2 });
    } finally { await removeFixture(fixture); }
  });

  test("answer racing a due timer produces one resolved terminal event", async () => {
    const { fixture, runId, playId } = await readyPlay(2);
    try {
      await admin.query(
        `update question_plays
            set opened_at = now() - interval '3 seconds',
                main_zero_at = now() - interval '2 seconds',
                final_window_ends_at = now() - interval '1 second'
          where id = $1`,
        [playId],
      );
      const [submitted, finalized] = await concurrently([
        (client) => answer(client, playId, runId, fixture.players[0].deviceId),
        (client) => rpc(client, "select public.finalize_current_play_if_due($1, $2, $3) as result", [fixture.roomCode, runId, playId]),
      ]);
      expect([submitted.result.code, finalized.result.code]).toContain("resolved");
      const terminal = await admin.query<{ status: string; terminal_events: number }>(
        `select status, (select count(*)::int from live_room_events where play_id = $1 and kind = 'play_resolved') as terminal_events
           from question_plays where id = $1`, [playId],
      );
      expect(terminal.rows[0]).toEqual({ status: "resolved", terminal_events: 1 });
    } finally { await removeFixture(fixture); }
  });

  test("duplicate and conflicting open commands serialize to one durable run", async () => {
    const fixture = await createFixture();
    try {
      const sameCommand = uuid();
      const duplicate = await concurrently([
        (client) => rpc(client, "select public.open_night_run($1, $2, null::uuid, 0::bigint) as result", [fixture.nightId, sameCommand]),
        (client) => rpc(client, "select public.open_night_run($1, $2, null::uuid, 0::bigint) as result", [fixture.nightId, sameCommand]),
      ]);
      expect(duplicate.filter((entry) => entry.freshlyApplied)).toHaveLength(1);
      expect(duplicate.map((entry) => entry.result.runId)).toEqual([duplicate[0].result.runId, duplicate[0].result.runId]);
      const conflicting = await concurrently([
        (client) => rpc(client, "select public.open_night_run($1, $2, null::uuid, 0::bigint) as result", [fixture.nightId, uuid()]),
        (client) => rpc(client, "select public.open_night_run($1, $2, null::uuid, 0::bigint) as result", [fixture.nightId, uuid()]),
      ]);
      expect(conflicting.map((entry) => entry.result.code).sort()).toEqual(["already_open", "already_open"]);
      const runs = await admin.query<{ count: number }>("select count(*)::int from live_night_runs where night_id = $1", [fixture.nightId]);
      expect(runs.rows[0].count).toBe(1);
    } finally { await removeFixture(fixture); }
  });

  test("Show Answer is idempotent when host retries concurrently", async () => {
    const { fixture, runId, playId } = await readyPlay();
    try {
      const command = uuid();
      const results = await concurrently([
        (client) => rpc(client, "select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result", [fixture.gameId, playId, runId, command]),
        (client) => rpc(client, "select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result", [fixture.gameId, playId, runId, command]),
      ]);
      expect(results.filter((entry) => entry.freshlyApplied)).toHaveLength(1);
      const state = await admin.query<{ status: string; events: number }>(
        `select status, (select count(*)::int from live_room_events where play_id = $1 and kind = 'final_window_started') as events
           from question_plays where id = $1`, [playId],
      );
      expect(state.rows[0]).toEqual({ status: "final_window", events: 1 });
    } finally { await removeFixture(fixture); }
  });

  test("an answer racing Show Answer serializes to one host transition and one canonical answer", async () => {
    const { fixture, runId, playId } = await readyPlay();
    try {
      const [submitted, shown] = await concurrently([
        (client) => answer(client, playId, runId, fixture.players[0].deviceId),
        (client) => rpc(client, "select public.begin_question_play_final_window($1, $2, $3, $4, 3::bigint) as result", [fixture.gameId, playId, runId, uuid()]),
      ]);
      expect(submitted.result.code).toBe("confirmed");
      expect(shown.result.code).toBe("applied");
      const state = await admin.query<{ status: string; answers: number; show_events: number }>(
        `select status,
                (select count(*)::int from question_play_answers where play_id = qp.id) as answers,
                (select count(*)::int from live_room_events where play_id = qp.id and kind = 'final_window_started') as show_events
           from question_plays qp where id = $1`,
        [playId],
      );
      expect(state.rows[0]).toEqual({ status: "final_window", answers: 1, show_events: 1 });
    } finally { await removeFixture(fixture); }
  });

  test("undo and a delayed answer serialize while its lost acknowledgement remains replayable", async () => {
    const { fixture, runId, playId } = await readyPlay(2);
    try {
      const submitted = await answer(admin, playId, runId, fixture.players[0].deviceId, uuid(), 2);
      const firstSubmission = (await admin.query<{ submission_id: string }>("select submission_id from question_play_answers where play_id = $1 and player_id = $2", [playId, fixture.players[0].id])).rows[0].submission_id;
      const [undone, delayed] = await concurrently([
        (client) => rpc(client, "select public.undo_question_play($1, $2, $3, $4, 3::bigint) as result", [fixture.gameId, playId, runId, uuid()]),
        (client) => answer(client, playId, runId, fixture.players[1].deviceId),
      ]);
      expect(undone.result.code).toBe("applied");
      // Either lock winner is valid; in both cases undo has the terminal say
      // and a previously accepted answer must remain canonically replayable.
      expect(["confirmed", "deadline_passed"]).toContain(delayed.result.code);
      const play = await admin.query<{ status: string }>("select status from question_plays where id = $1", [playId]);
      expect(play.rows[0].status).toBe("undone");
      const replay = await answer(admin, playId, runId, fixture.players[0].deviceId, firstSubmission, 4);
      expect(replay).toEqual({ freshlyApplied: false, result: submitted.result });
    } finally { await removeFixture(fixture); }
  });

  test("ending a game with unfinished play is rejected without a game_ended transition", async () => {
    const { fixture, runId } = await readyPlay();
    try {
      const ended = await rpc(admin, "select public.end_live_game($1, $2, $3, 3::bigint) as result", [fixture.gameId, runId, uuid()]);
      expect(ended).toMatchObject({ freshlyApplied: false, result: { code: "invalid_state" } });
      const events = await admin.query<{ count: number }>("select count(*)::int from live_room_events where game_id = $1 and kind = 'game_ended'", [fixture.gameId]);
      expect(events.rows[0].count).toBe(0);
    } finally { await removeFixture(fixture); }
  });

  test("reset rotates the run and makes delayed old-run answers stale", async () => {
    const { fixture, runId, playId } = await readyPlay();
    try {
      const reset = await rpc(admin, "select public.reset_live_night_to_setup($1, $2, $3, 3::bigint) as result", [fixture.nightId, runId, uuid()]);
      expect(reset.result).toMatchObject({ code: "applied", eventKind: "night_reset", runId: expect.any(String) });
      expect(reset.result.runId).not.toBe(runId);
      const delayed = await answer(admin, playId, runId, fixture.players[0].deviceId);
      expect(delayed).toMatchObject({ freshlyApplied: false, result: { code: "not_eligible" } });
    } finally { await removeFixture(fixture); }
  });

  test("eligibility freezes late joins, removals, reconnects, and score-only players", async () => {
    const fixture = await createFixture(1);
    try {
      const scoreOnly = { id: uuid(), deviceId: uuid() };
      await admin.query("insert into players (id, night_id, device_id, display_name, can_answer) values ($1, $2, $3, 'Score only', false)", [scoreOnly.id, fixture.nightId, scoreOnly.deviceId]);
      await admin.query("insert into game_participations (game_id, player_id) values ($1, $2)", [fixture.gameId, scoreOnly.id]);
      const runId = await openRun(fixture);
      await startGame(fixture, runId);
      const playId = await openPlay(fixture, runId);
      const late = { id: uuid(), deviceId: uuid() };
      await admin.query("insert into players (id, night_id, device_id, display_name) values ($1, $2, $3, 'Late')", [late.id, fixture.nightId, late.deviceId]);
      await admin.query("insert into game_participations (game_id, player_id) values ($1, $2)", [fixture.gameId, late.id]);
      await admin.query("update players set removed_at = now() where id = $1", [fixture.players[0].id]);
      expect((await answer(admin, playId, runId, late.deviceId)).result.code).toBe("not_eligible");
      expect((await answer(admin, playId, runId, scoreOnly.deviceId)).result.code).toBe("not_eligible");
      expect((await answer(admin, playId, runId, fixture.players[0].deviceId)).result.code).toBe("confirmed");
      const eligible = await admin.query<{ count: number }>("select count(*)::int from question_play_eligibility where play_id = $1", [playId]);
      expect(eligible.rows[0].count).toBe(1);
    } finally { await removeFixture(fixture); }
  });

  test("exact deadline and speed boundaries are database-authoritative", async () => {
    const { fixture, runId, playId } = await readyPlay();
    try {
      await admin.query(
        `update question_plays
            set opened_at = now() - interval '3 seconds',
                main_zero_at = now() - interval '2 seconds',
                final_window_ends_at = now() - interval '1 second'
          where id = $1`,
        [playId],
      );
      expect((await answer(admin, playId, runId, fixture.players[0].deviceId)).result.code).toBe("deadline_passed");
      await admin.query("update question_plays set final_window_ends_at = now() + interval '2 seconds' where id = $1", [playId]);
      const accepted = await answer(admin, playId, runId, fixture.players[0].deviceId, uuid(), 1);
      expect(accepted.result.code).toBe("confirmed");
      await admin.query(
        `update question_plays
            set opened_at = now() - interval '3 seconds',
                main_zero_at = now() - interval '2 seconds',
                final_window_ends_at = now() - interval '1 second'
          where id = $1`,
        [playId],
      );
      const replay = await answer(admin, playId, runId, fixture.players[0].deviceId, uuid(), 4);
      expect(replay).toEqual({ freshlyApplied: false, result: accepted.result });

      // Resolve the accepted pre-deadline answer at the exact speed threshold:
      // <5000ms earns the 10% bonus, while 5000ms does not.
      await admin.query("update question_play_answers set ms_to_lock = 4999, canonical_index = 0 where play_id = $1", [playId]);
      const resolved = await rpc(admin, "select public.finalize_current_play_if_due($1, $2, $3) as result", [fixture.roomCode, runId, playId]);
      expect(resolved.result.code).toBe("resolved");
      const bonus = await admin.query<{ awarded_points: number }>("select awarded_points from question_play_answers where play_id = $1", [playId]);
      expect(bonus.rows[0].awarded_points).toBe(110);

      const boundary = await readyPlay();
      try {
        await answer(admin, boundary.playId, boundary.runId, boundary.fixture.players[0].deviceId);
        await admin.query(
          `update question_plays
              set opened_at = now() - interval '3 seconds',
                  main_zero_at = now() - interval '2 seconds',
                  final_window_ends_at = now() - interval '1 second'
            where id = $1`,
          [boundary.playId],
        );
        await admin.query("update question_play_answers set ms_to_lock = 5000, canonical_index = 0 where play_id = $1", [boundary.playId]);
        expect((await rpc(admin, "select public.finalize_current_play_if_due($1, $2, $3) as result", [boundary.fixture.roomCode, boundary.runId, boundary.playId])).result.code).toBe("resolved");
        const noBonus = await admin.query<{ awarded_points: number }>("select awarded_points from question_play_answers where play_id = $1", [boundary.playId]);
        expect(noBonus.rows[0].awarded_points).toBe(100);
      } finally { await removeFixture(boundary.fixture); }
    } finally { await removeFixture(fixture); }
  });

  test("forty players with duplicate retries yield forty answers and one terminal transition", async () => {
    const { fixture, runId, playId } = await readyPlay(40);
    try {
      const initialAttempts = fixture.players.map((player) => {
        const submission = uuid();
        return { player, submission };
      });
      // Forty separate connections race the first answers. Retries are a
      // second independent wave so this remains within local PostgreSQL's
      // connection budget rather than masking the race behind a pool.
      const firstWave = await concurrently(initialAttempts.map(({ player, submission }) =>
        (client) => answer(client, playId, runId, player.deviceId, submission, 1),
      ));
      const retryWave = await concurrently(initialAttempts.map(({ player, submission }) =>
        (client) => answer(client, playId, runId, player.deviceId, submission, 1),
      ));
      expect(firstWave.filter((entry) => entry.freshlyApplied)).toHaveLength(40);
      expect(retryWave.filter((entry) => entry.freshlyApplied)).toHaveLength(0);
      const answerCount = await admin.query<{ count: number; status: string }>(
        "select (select count(*)::int from question_play_answers where play_id = $1) as count, status from question_plays where id = $1", [playId],
      );
      expect(answerCount.rows[0]).toEqual({ count: 40, status: "all_in_hold" });
      await admin.query(
        `update question_plays
            set opened_at = now() - interval '5 seconds',
                main_zero_at = now() + interval '20 seconds',
                final_window_ends_at = now() + interval '22 seconds',
                finalize_at = now() - interval '1 second'
          where id = $1`,
        [playId],
      );
      const finalized = await concurrently(Array.from({ length: 8 }, () => (client) => rpc(client, "select public.finalize_current_play_if_due($1, $2, $3) as result", [fixture.roomCode, runId, playId])));
      expect(finalized.filter((entry) => entry.freshlyApplied)).toHaveLength(1);
      const terminal = await admin.query<{ count: number }>("select count(*)::int from live_room_events where play_id = $1 and kind = 'play_resolved'", [playId]);
      expect(terminal.rows[0].count).toBe(1);
    } finally { await removeFixture(fixture); }
  });
});
