// Diagnostic logging on POST /api/answers.
//
// The promise under test: logging records every tap from a REAL player of the
// night (saved, late, early, duplicate, turned down) AFTER the response, stores
// nothing for a caller who is not one, and a logging problem of any kind can
// never change the status or the body the phone gets.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ getDeviceId: vi.fn() }));
const projectionMock = vi.hoisted(() => ({ projectExactLiveEvent: vi.fn() }));
const broadcastMock = vi.hoisted(() => ({ broadcastAppliedLiveRoomEvent: vi.fn() }));
const writeMock = vi.hoisted(() => ({
  scheduleDiagWrite: vi.fn(),
  recordDiagRows: vi.fn(),
  noteIgnored: vi.fn(),
  lookupNightOwner: vi.fn(),
  lookupQuestionContext: vi.fn(),
  lookupPlayerId: vi.fn(),
  lookupGameNight: vi.fn(),
  lookupRoomNight: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/live-answer/projectEvent", () => projectionMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);
vi.mock("@/lib/diagnostics/write", () => writeMock);

import { DiagLookupSlow } from "@/lib/diagnostics/deadline";

const QUESTION_ID = "11111111-1111-1111-1111-111111111111";
const CATEGORY_ID = "22222222-2222-2222-2222-222222222222";
const GAME_ID = "33333333-3333-3333-3333-333333333333";
const NIGHT_ID = "44444444-4444-4444-4444-444444444444";
const PLAYER_ID = "55555555-5555-5555-5555-555555555555";
const DEVICE_ID = "66666666-6666-6666-6666-666666666666";
const PLAY_ID = "77777777-7777-4777-8777-777777777777";
const RUN_ID = "88888888-8888-8888-8888-888888888888";
const SUBMISSION_ID = "99999999-9999-4999-8999-999999999999";

type DbResult = { data: unknown; error: { code?: string; message: string } | null };

function query(result: DbResult | undefined) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    insert: vi.fn(async () => result),
  };
  return builder;
}

function legacyAdmin(options: {
  playedAt: string | null;
  insertError?: { code?: string; message: string } | null;
}) {
  const rows: Record<string, DbResult> = {
    questions: {
      data: {
        id: QUESTION_ID,
        category_id: CATEGORY_ID,
        played_at: options.playedAt,
        finished_at: null,
        correct_index: 0,
      },
      error: null,
    },
    categories: { data: { id: CATEGORY_ID, game_id: GAME_ID }, error: null },
    games: { data: { id: GAME_ID, night_id: NIGHT_ID }, error: null },
    nights: { data: { id: NIGHT_ID, answer_engine: "legacy" }, error: null },
    players: { data: { id: PLAYER_ID, removed_at: null }, error: null },
    game_participations: { data: { id: "participation" }, error: null },
  };
  const insert = vi.fn(async () => ({ data: null, error: options.insertError ?? null }));
  return {
    rpc: vi.fn(),
    from: vi.fn((table: string) => (table === "answers" ? { insert } : query(rows[table]))),
  };
}

function resilientAdmin() {
  const play = {
    id: PLAY_ID,
    night_id: NIGHT_ID,
    run_id: RUN_ID,
    game_id: GAME_ID,
    question_id: QUESTION_ID,
    status: "accepting",
    opened_at: "2026-07-19T01:00:00.000Z",
    main_zero_at: "2026-07-19T01:00:30.000Z",
    final_window_starts_at: null,
    final_window_ends_at: "2026-07-19T01:00:32.000Z",
    finalize_at: null,
    eligible_count: 3,
    confirmed_count: 1,
  };
  const rows: Record<string, DbResult> = {
    question_plays: { data: play, error: null },
    nights: {
      data: {
        id: NIGHT_ID,
        answer_engine: "resilient_v1",
        current_run_id: RUN_ID,
        room_code: "ABCDEF",
        room_revision: 7,
        control_revision: 5,
      },
      error: null,
    },
  };
  const results = [
    { freshlyApplied: true, result: { code: "claimed", duplicate: false, runId: RUN_ID, playId: PLAY_ID } },
    {
      freshlyApplied: true,
      result: {
        code: "confirmed",
        confirmedSlot: 3,
        duplicate: false,
        eventKind: "answer_progress",
        runId: RUN_ID,
        gameId: GAME_ID,
        questionId: QUESTION_ID,
        playId: PLAY_ID,
        roomRevision: 8,
        controlRevision: 5,
      },
    },
  ];
  return {
    rpc: vi.fn(async () => ({ data: results.shift() ?? null, error: null })),
    from: vi.fn((table: string) => query(rows[table])),
  };
}

const live = {
  runId: RUN_ID,
  roomRevision: 8,
  controlRevision: 5,
  playId: PLAY_ID,
  play: null,
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://test/api/answers", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

interface Scenario {
  name: string;
  now: string;
  admin: () => unknown;
  body: () => Promise<unknown>;
  status: number;
  outcome: string;
  reason: string;
}

async function legacyBody() {
  const { scrambleFor } = await import("@/lib/game/scramble");
  return { questionId: QUESTION_ID, slotChosen: 1, scramble: scrambleFor(QUESTION_ID, PLAYER_ID) };
}

const SCENARIOS: Scenario[] = [
  {
    name: "legacy saved",
    now: "2026-07-19T01:00:10.000Z",
    admin: () => legacyAdmin({ playedAt: "2026-07-19T01:00:00.000Z" }),
    body: legacyBody,
    status: 204,
    outcome: "saved",
    reason: "saved",
  },
  {
    name: "legacy late (after the 25 s line)",
    now: "2026-07-19T01:00:26.000Z",
    admin: () => legacyAdmin({ playedAt: "2026-07-19T01:00:00.000Z" }),
    body: legacyBody,
    status: 400,
    outcome: "late",
    reason: "deadline_passed",
  },
  {
    name: "legacy early (question not live)",
    now: "2026-07-19T01:00:10.000Z",
    admin: () => legacyAdmin({ playedAt: null }),
    body: legacyBody,
    status: 409,
    outcome: "early",
    reason: "question_not_live",
  },
  {
    name: "legacy duplicate",
    now: "2026-07-19T01:00:10.000Z",
    admin: () =>
      legacyAdmin({
        playedAt: "2026-07-19T01:00:00.000Z",
        insertError: { code: "23505", message: "duplicate key" },
      }),
    body: legacyBody,
    status: 409,
    outcome: "duplicate",
    reason: "already_answered",
  },
  {
    name: "legacy turned down by the database deadline rule",
    now: "2026-07-19T01:00:24.000Z",
    admin: () =>
      legacyAdmin({
        playedAt: "2026-07-19T01:00:00.000Z",
        insertError: { code: "TR025", message: "late" },
      }),
    body: legacyBody,
    status: 400,
    outcome: "late",
    reason: "deadline_passed_at_save",
  },
  {
    name: "resilient confirmed",
    now: "2026-07-19T01:00:10.000Z",
    admin: resilientAdmin,
    body: async () => ({ playId: PLAY_ID, runId: RUN_ID, submissionId: SUBMISSION_ID, slotChosen: 3 }),
    status: 200,
    outcome: "saved",
    reason: "saved",
  },
];

type Mode = "off" | "on" | "on-insert-throws" | "on-scheduler-throws";

async function run(scn: Scenario, mode: Mode, headers: Record<string, string> = {}) {
  vi.stubEnv("DIAGNOSTIC_LOGGING", mode === "off" ? "off" : "on");
  vi.setSystemTime(scn.now);
  adminMock.getSupabaseAdmin.mockReturnValue(scn.admin());
  const pending: Array<() => Promise<void>> = [];
  writeMock.scheduleDiagWrite.mockImplementation((task: () => Promise<void>) => {
    if (mode === "on-scheduler-throws") throw new Error("scheduler exploded");
    pending.push(task);
  });
  writeMock.recordDiagRows.mockImplementation(async () => {
    if (mode === "on-insert-throws") throw new Error("diag table missing");
  });

  const { POST } = await import("@/app/api/answers/route");
  const response = await POST(post(await scn.body(), headers));
  const text = await response.text();

  // Run the "after the response" work the way Next would, swallowing failures.
  for (const task of pending) await task().catch(() => {});
  return { status: response.status, text, pending: pending.length };
}

describe("POST /api/answers diagnostic log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    projectionMock.projectExactLiveEvent.mockResolvedValue(live);
    broadcastMock.broadcastAppliedLiveRoomEvent.mockResolvedValue(true);
    writeMock.lookupQuestionContext.mockResolvedValue({ gameId: GAME_ID, nightId: NIGHT_ID });
    writeMock.lookupPlayerId.mockResolvedValue(PLAYER_ID);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("is off by default: nothing is scheduled and nothing is written", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("DIAGNOSTIC_LOGGING", "");
    const scn = SCENARIOS[0]!;
    vi.setSystemTime(scn.now);
    adminMock.getSupabaseAdmin.mockReturnValue(scn.admin());
    const { POST } = await import("@/app/api/answers/route");
    const response = await POST(post(await scn.body()));
    expect(response.status).toBe(204);
    expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
    expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
  });

  describe.each(SCENARIOS)("$name", (scn) => {
    it("sends the phone exactly the same answer whatever logging does", async () => {
      const baseline = await run(scn, "off");
      expect(baseline.status).toBe(scn.status);
      expect(baseline.pending).toBe(0);

      for (const mode of ["on", "on-insert-throws", "on-scheduler-throws"] as const) {
        const logged = await run(scn, mode);
        expect(logged.status, mode).toBe(baseline.status);
        expect(logged.text, mode).toBe(baseline.text);
      }
    });

    it("records the tap with its outcome and reason, for the real player who sent it", async () => {
      await run(scn, "on", {
        "x-tr1via-tap-at": "1784422809000",
        "x-tr1via-sent-at": "1784422809400",
        "x-tr1via-attempt": "2",
      });
      expect(writeMock.recordDiagRows).toHaveBeenCalledTimes(1);
      const [table, rows, night, source] = writeMock.recordDiagRows.mock.calls[0] as [
        string,
        Record<string, unknown>[],
        string,
        unknown,
      ];
      expect(table).toBe("diag_answer_events");
      expect(night).toBe(NIGHT_ID);
      expect(source).toEqual({ kind: "tap", deviceId: DEVICE_ID });
      expect(rows).toHaveLength(1);
      expect(writeMock.noteIgnored).not.toHaveBeenCalled();
      expect(rows[0]).toMatchObject({
        outcome: scn.outcome,
        reason: scn.reason,
        http_status: scn.status,
        question_id: QUESTION_ID,
        device_id: DEVICE_ID,
        night_id: NIGHT_ID,
        client_tap_at: new Date(1784422809000).toISOString(),
        client_sent_at: new Date(1784422809400).toISOString(),
        client_attempt: 2,
      });
      expect(rows[0]!.received_at).toBe(new Date(scn.now).toISOString());
    });
  });

  it("fills in the player and night for a tap turned away before the player lookup", async () => {
    // A late tap is refused before the route ever looks the player up.
    const late = SCENARIOS[1]!;
    await run(late, "on");
    const rows = writeMock.recordDiagRows.mock.calls[0]![1] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ player_id: PLAYER_ID, night_id: NIGHT_ID, game_id: GAME_ID });
    expect(rows[0]!.ms_after_open).toBe(26_000);
    expect(rows[0]!.deadline_s).toBe(25);
    expect(writeMock.lookupPlayerId).toHaveBeenCalledWith(NIGHT_ID, DEVICE_ID);
  });

  it("records step timings and ignores a nonsense tap header", async () => {
    const scn = SCENARIOS[0]!;
    await run(scn, "on", { "x-tr1via-tap-at": "not-a-number", "x-tr1via-attempt": "999" });
    const row = (writeMock.recordDiagRows.mock.calls[0]![1] as Record<string, unknown>[])[0]!;
    expect(row.client_tap_at).toBeNull();
    expect(row.client_attempt).toBeNull();
    expect(Object.keys(row.steps as object)).toEqual(
      expect.arrayContaining(["question", "player", "insert", "total"]),
    );
  });

  describe("a caller who is not a verified player stores NOTHING", () => {
    it("a tap with no device session: the phone still gets its 401, and not even an after-the-response job is queued", async () => {
      authMock.getDeviceId.mockResolvedValue(null);
      const scn = SCENARIOS[0]!;
      const result = await run(scn, "on");
      expect(result.status).toBe(401);
      expect(result.pending).toBe(0);
      expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      expect(writeMock.lookupQuestionContext).not.toHaveBeenCalled();
      expect(writeMock.lookupPlayerId).not.toHaveBeenCalled(); // no database reads for it either
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("answer");
    });

    it("a real cookie that never joined this night (a free cookie from /api/session/init)", async () => {
      writeMock.lookupPlayerId.mockResolvedValue(null);
      // a late tap is turned away before the route looks the player up
      const late = SCENARIOS[1]!;
      await run(late, "on");
      expect(writeMock.lookupPlayerId).toHaveBeenCalledWith(NIGHT_ID, DEVICE_ID);
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("answer");
    });

    it("a lookup that is too slow to answer is NOT taken for 'not a player': nothing is stored, and it is not counted as a stranger", async () => {
      writeMock.lookupPlayerId.mockRejectedValue(new DiagLookupSlow());
      const late = SCENARIOS[1]!;
      await run(late, "on"); // (run swallows the failure the way scheduleDiagWrite does)
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).not.toHaveBeenCalled(); // scheduleDiagWrite counts it as "slow"
      // the phone still got its normal answer
      const baseline = await run(late, "off");
      expect(baseline.status).toBe(400);
    });

    it("a tap about a question that does not exist", async () => {
      writeMock.lookupQuestionContext.mockResolvedValue({ gameId: null, nightId: null });
      await run(SCENARIOS[2]!, "on");
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      expect(writeMock.lookupPlayerId).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("answer");
    });

    it("but a real player's late, early and duplicate taps ARE stored (that is the whole point)", async () => {
      for (const scn of [SCENARIOS[1]!, SCENARIOS[2]!, SCENARIOS[3]!, SCENARIOS[4]!]) {
        writeMock.recordDiagRows.mockClear();
        await run(scn, "on");
        expect(writeMock.recordDiagRows, scn.name).toHaveBeenCalledTimes(1);
        const row = (writeMock.recordDiagRows.mock.calls[0]![1] as Record<string, unknown>[])[0]!;
        expect(row, scn.name).toMatchObject({ outcome: scn.outcome, player_id: PLAYER_ID });
      }
    });
  });

  it("logs a thrown error and re-throws the very same error", async () => {
    const boom = new Error("database exploded");
    adminMock.getSupabaseAdmin.mockImplementation(() => {
      throw boom;
    });
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    const pending: Array<() => Promise<void>> = [];
    writeMock.scheduleDiagWrite.mockImplementation((task: () => Promise<void>) => {
      pending.push(task);
    });
    const { POST } = await import("@/app/api/answers/route");
    await expect(POST(post(await legacyBody()))).rejects.toBe(boom);
    for (const task of pending) await task();
    const row = (writeMock.recordDiagRows.mock.calls[0]![1] as Record<string, unknown>[])[0]!;
    expect(row).toMatchObject({ outcome: "error", reason: "exception" });
  });
});
