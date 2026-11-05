import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  closeQuestionIfDue,
  type CloseDeps,
  type CloseOutcome,
} from "@/lib/live/closeDue";

// Candidate 1's two races, on real row locks. Needs the rig in repo-head mode,
// because prod-parity leaves out the 25-second trigger under test:
//   node rig.mjs reset --mode repo-head
// A gate transaction holds the question row so every racer is provably queued
// on the lock before any of them moves, instead of hoping they overlap.

type Fixture = {
  hostUserId: string;
  hostId: string;
  gameId: string;
  questionId: string;
  roomCode: string;
  playerIds: string[];
};
type Admin = Parameters<typeof closeQuestionIfDue>[0];

const databaseUrl = process.env.TR1VIA_RACE_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Never let this harness point at a hosted Supabase project by mistake.
const target = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost", "::1"].includes(target.hostname)
  || target.port !== "54322"
  || target.pathname !== "/postgres"
  || target.search
  || target.hash
) {
  throw new Error("TR1VIA_RACE_DATABASE_URL must target 127.0.0.1:54322/postgres (or localhost/::1 equivalent)");
}

let admin: Client;

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function connectMany(count: number): Promise<Client[]> {
  const clients: Client[] = [];
  for (let index = 0; index < count; index += 1) clients.push(await connect());
  return clients;
}

async function pidOf(client: Client): Promise<number> {
  const { rows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
  return rows[0].pid;
}

async function createFixture(playerCount: number, playedSecondsAgo: number): Promise<Fixture> {
  const uuid = () => crypto.randomUUID();
  const [hostUserId, hostId, nightId, gameId, categoryId, questionId] = Array.from({ length: 6 }, uuid);
  const roomCode = `C${uuid().replaceAll("-", "").slice(0, 5).toUpperCase()}`;
  await admin.query("insert into auth.users (id) values ($1)", [hostUserId]);
  await admin.query("insert into hosts (id, user_id, display_name) values ($1, $2, 'Close host')", [hostId, hostUserId]);
  await admin.query(
    "insert into nights (id, host_id, venue_name, room_code) values ($1, $2, 'Close venue', $3)",
    [nightId, hostId, roomCode],
  );
  await admin.query(
    "insert into games (id, night_id, game_no, state) values ($1, $2, 1, 'ready')",
    [gameId, nightId],
  );
  await admin.query(
    "insert into categories (id, game_id, name, topic, position, state) values ($1, $2, 'Close', 'Close', 0, 'ready')",
    [categoryId, gameId],
  );
  await admin.query(
    `insert into questions (id, category_id, point_value, prompt, options, correct_index, is_picked)
     values ($1, $2, 100, 'Close question?', '["A","B","C","D"]'::jsonb, 0, true)`,
    [questionId, categoryId],
  );
  const playerIds = Array.from({ length: playerCount }, () => uuid());
  for (const [index, playerId] of playerIds.entries()) {
    await admin.query(
      "insert into players (id, night_id, device_id, display_name) values ($1, $2, $3, $4)",
      [playerId, nightId, uuid(), `Player ${index + 1}`],
    );
    await admin.query("insert into game_participations (game_id, player_id) values ($1, $2)", [gameId, playerId]);
  }
  await admin.query("update games set state = 'live', started_at = now() where id = $1", [gameId]);
  await admin.query(
    "update questions set played_at = now() - $2::double precision * interval '1 second' where id = $1",
    [questionId, playedSecondsAgo],
  );
  await admin.query(
    "insert into reveals (game_id, question_id, event, occurred_at) select $1::uuid, id, 'reveal', played_at from questions where id = $2",
    [gameId, questionId],
  );
  return { hostUserId, hostId, gameId, questionId, roomCode, playerIds };
}

async function removeFixture(fixture: Fixture): Promise<void> {
  await admin.query("delete from hosts where id = $1", [fixture.hostId]);
  await admin.query("delete from auth.users where id = $1", [fixture.hostUserId]);
}

async function holdQuestionRow(questionId: string): Promise<Client> {
  const gate = await connect();
  await gate.query("begin");
  await gate.query("select 1 from questions where id = $1 for update", [questionId]);
  return gate;
}

async function waitForLockWaiters(pids: number[], expected: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  let waiting = 0;
  while (Date.now() < deadline) {
    const { rows } = await admin.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity
        where pid = any($1::int[]) and wait_event_type = 'Lock'`,
      [pids],
    );
    waiting = rows[0].waiting;
    if (waiting >= expected) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error(`only ${waiting} of ${expected} racers reached the row lock`);
}

/** The two calls closeQuestionIfDue makes, on a real connection in place of PostgREST. */
function pgAdmin(client: Client): Admin {
  const maybeSingle = (id: string) => async () => {
    const { rows } = await client.query(
      `select to_json(played_at) #>> '{}' as played_at,
              to_json(finished_at) #>> '{}' as finished_at,
              correct_index
         from questions where id = $1`,
      [id],
    );
    return { data: rows[0] ?? null, error: null };
  };
  return {
    from: () => ({
      select: () => ({
        eq: (_column: string, id: string) => ({ maybeSingle: maybeSingle(id) }),
      }),
    }),
    rpc: async (_name: string, args: { p_question_id: string }) => {
      try {
        const { rows } = await client.query<{ won: boolean }>(
          "select public.resolve_question_once($1) as won",
          [args.p_question_id],
        );
        return { data: rows[0].won, error: null };
      } catch (error) {
        return { data: null, error: { code: (error as { code?: string }).code } };
      }
    },
  } as unknown as Admin;
}

async function playedAtText(questionId: string): Promise<string> {
  const { rows } = await admin.query<{ played_at: string }>(
    "select to_json(played_at) #>> '{}' as played_at from questions where id = $1",
    [questionId],
  );
  return rows[0].played_at;
}

function countingDeps() {
  const lines: Array<Record<string, unknown>> = [];
  const deps = {
    broadcastResolve: vi.fn(async () => undefined),
    broadcastSalvo: vi.fn(async () => undefined),
    sink: (line: string) => lines.push(JSON.parse(line)),
  } satisfies CloseDeps;
  return { deps, lines };
}

async function closeWith(client: Client, fixture: Fixture, deps: CloseDeps): Promise<CloseOutcome> {
  return closeQuestionIfDue(pgAdmin(client), {
    questionId: fixture.questionId,
    expectedPlayedAt: await playedAtText(fixture.questionId),
    roomCode: fixture.roomCode,
    source: "snapshot-tick",
    themeKey: undefined,
  }, deps);
}

async function resolveRows(questionId: string): Promise<number> {
  const { rows } = await admin.query<{ resolves: number }>(
    "select count(*)::int as resolves from reveals where question_id = $1 and event = 'resolve'",
    [questionId],
  );
  return rows[0].resolves;
}

beforeAll(async () => {
  vi.stubEnv("LIVE_CLOSE_MODE", "on");
  admin = await connect();
  const { rows } = await admin.query<{ definition: string | null; installed: boolean }>(
    `select pg_get_functiondef(to_regprocedure('public.enforce_legacy_answer_deadline()')) as definition,
            exists (
              select 1 from pg_trigger
               where tgname = 'answers_enforce_legacy_deadline' and not tgisinternal
            ) as installed`,
  );
  if (!rows[0].installed) {
    throw new Error("the 25-second trigger is missing: run node rig.mjs reset --mode repo-head");
  }
  expect(rows[0].definition).toMatch(/for update/i);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await admin.end();
});

describe("legacy close races", () => {
  test("50 on-time answers crossing the close are all kept and scored, with one winner", async () => {
    const fixture = await createFixture(50, 25.05);
    const answerClients = await connectMany(50);
    const closerClient = await connect();
    const gate = await holdQuestionRow(fixture.questionId);
    let gateOpen = true;
    try {
      const pids = await Promise.all(answerClients.map(pidOf));
      const closerPid = await pidOf(closerClient);
      // Received inside the window, committing around the close. Even seats
      // pick the right answer. 24.9s is past the 5s speed bonus.
      const send = (client: Client, index: number) =>
        client.query<{ is_correct: boolean | null }>(
          `insert into answers (question_id, player_id, chosen_index, scramble, ms_to_lock, locked_at)
           select q.id, $2::uuid, $3::int, '[0,1,2,3]'::jsonb, 24900, q.played_at + interval '24.9 seconds'
             from questions q where q.id = $1
           returning is_correct`,
          [fixture.questionId, fixture.playerIds[index], index % 2],
        );

      const firstHalf = answerClients.slice(0, 25).map((client, index) => send(client, index));
      await waitForLockWaiters(pids.slice(0, 25), 25);
      const close = closerClient.query<{ won: boolean }>(
        "select public.resolve_question_once($1) as won",
        [fixture.questionId],
      );
      await waitForLockWaiters([closerPid], 1);
      const secondHalf = answerClients.slice(25).map((client, index) => send(client, index + 25));
      await waitForLockWaiters(pids.slice(25), 25);

      await gate.query("commit");
      gateOpen = false;
      const [closed, inserted] = await Promise.all([
        close,
        Promise.all([...firstHalf, ...secondHalf]),
      ]);

      expect(closed.rows[0].won).toBe(true);
      // The trigger fills is_correct only on a row that arrives after the close,
      // so this proves the race really crossed in both directions.
      const scoredByTrigger = inserted.filter(({ rows }) => rows[0].is_correct !== null).length;
      expect(scoredByTrigger).toBeGreaterThan(0);
      expect(scoredByTrigger).toBeLessThan(50);

      const { rows } = await admin.query(
        `select count(*)::int as answers,
                count(*) filter (where is_correct is null or awarded_points is null)::int as unscored,
                count(*) filter (where is_correct)::int as correct,
                coalesce(sum(awarded_points), 0)::int as points
           from answers where question_id = $1`,
        [fixture.questionId],
      );
      expect(rows[0]).toEqual({ answers: 50, unscored: 0, correct: 25, points: 2_500 });
      await expect(resolveRows(fixture.questionId)).resolves.toBe(1);
    } finally {
      if (gateOpen) await gate.query("rollback");
      await Promise.all([...answerClients, closerClient, gate].map((client) => client.end()));
      await removeFixture(fixture);
    }
  });

  test("a first send at 25.000s is refused after the close", async () => {
    const fixture = await createFixture(1, 26.2);
    try {
      await admin.query("select public.resolve_question_once($1)", [fixture.questionId]);
      await expect(admin.query(
        `insert into answers (question_id, player_id, chosen_index, scramble, ms_to_lock, locked_at)
         select q.id, $2::uuid, 0, '[0,1,2,3]'::jsonb, 25000, q.played_at + interval '25 seconds'
           from questions q where q.id = $1`,
        [fixture.questionId, fixture.playerIds[0]],
      )).rejects.toMatchObject({ code: "TR025" });
    } finally {
      await removeFixture(fixture);
    }
  });

  test("the closer leaves a question alone before 26.2s", async () => {
    const fixture = await createFixture(0, 25.5);
    const { deps } = countingDeps();
    try {
      await expect(closeWith(admin, fixture, deps)).resolves.toBe("not-overdue");
      await expect(resolveRows(fixture.questionId)).resolves.toBe(0);
    } finally {
      await removeFixture(fixture);
    }
  });

  test("a closer at 26.2s against 20 /resolve callers: one winner, one broadcast", async () => {
    const fixture = await createFixture(0, 26.2);
    const callers = await connectMany(20);
    const closerClient = await connect();
    const gate = await holdQuestionRow(fixture.questionId);
    const { deps, lines } = countingDeps();
    let gateOpen = true;
    let routeBroadcasts = 0;
    try {
      const pids = await Promise.all([...callers, closerClient].map(pidOf));
      // What /resolve does with the same function: broadcast only on true.
      const racingCallers = callers.map(async (client) => {
        const { rows } = await client.query<{ won: boolean }>(
          "select public.resolve_question_once($1) as won",
          [fixture.questionId],
        );
        if (rows[0].won) routeBroadcasts += 1;
        return rows[0].won;
      });
      const closing = closeWith(closerClient, fixture, deps);
      await waitForLockWaiters(pids, 21);

      await gate.query("commit");
      gateOpen = false;
      const [outcome, wins] = await Promise.all([closing, Promise.all(racingCallers)]);

      const closerWon = outcome === "closed";
      expect(outcome).toMatch(/^(closed|lost-race)$/);
      expect(wins.filter(Boolean).length + (closerWon ? 1 : 0)).toBe(1);
      expect(routeBroadcasts + deps.broadcastResolve.mock.calls.length).toBe(1);
      expect(deps.broadcastSalvo).toHaveBeenCalledTimes(closerWon ? 1 : 0);
      expect(lines).toHaveLength(closerWon ? 1 : 0);
      await expect(resolveRows(fixture.questionId)).resolves.toBe(1);
    } finally {
      if (gateOpen) await gate.query("rollback");
      await Promise.all([...callers, closerClient, gate].map((client) => client.end()));
      await removeFixture(fixture);
    }
  });

  test("20 closers at 26.2s from different instances: one winner, one broadcast", async () => {
    const fixture = await createFixture(0, 26.2);
    const closers = await connectMany(20);
    const gate = await holdQuestionRow(fixture.questionId);
    const { deps, lines } = countingDeps();
    let gateOpen = true;
    try {
      const pids = await Promise.all(closers.map(pidOf));
      const closing = closers.map((client) => closeWith(client, fixture, deps));
      await waitForLockWaiters(pids, 20);

      await gate.query("commit");
      gateOpen = false;
      const outcomes = await Promise.all(closing);

      expect(outcomes.filter((outcome) => outcome === "closed")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === "lost-race")).toHaveLength(19);
      expect(deps.broadcastResolve).toHaveBeenCalledTimes(1);
      expect(deps.broadcastSalvo).toHaveBeenCalledTimes(1);
      expect(lines).toEqual([expect.objectContaining({ kind: "close", closedBy: "snapshot-tick" })]);
      await expect(resolveRows(fixture.questionId)).resolves.toBe(1);
    } finally {
      if (gateOpen) await gate.query("rollback");
      await Promise.all([...closers, gate].map((client) => client.end()));
      await removeFixture(fixture);
    }
  });
});
