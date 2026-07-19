import { beforeEach, describe, expect, it, vi } from "vitest";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const projectionMock = vi.hoisted(() => ({ projectExactLiveEvent: vi.fn() }));
const broadcastMock = vi.hoisted(() => ({
  broadcastAppliedLiveRoomEvent: vi.fn(),
  broadcastFireworks: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/live-answer/projectEvent", () => projectionMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const NIGHT_ID = "44444444-4444-4444-4444-444444444444";
const GAME_ID = "33333333-3333-3333-3333-333333333333";
const QUESTION_ID = "11111111-1111-1111-1111-111111111111";
const PLAY_ID = "77777777-7777-7777-7777-777777777777";
const RUN_ID = "88888888-8888-8888-8888-888888888888";
const CURRENT_PLAY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type DbResult = { data: unknown; error: { message: string } | null };

function query(result: DbResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  };
  return builder;
}

const play = {
  id: PLAY_ID,
  night_id: NIGHT_ID,
  run_id: RUN_ID,
  game_id: GAME_ID,
  question_id: QUESTION_ID,
  status: "final_window",
  opened_at: "2026-07-19T01:00:00.000Z",
  main_zero_at: "2026-07-19T01:00:30.000Z",
  final_window_starts_at: "2026-07-19T01:00:30.000Z",
  final_window_ends_at: "2026-07-19T01:00:32.000Z",
  finalize_at: "2026-07-19T01:00:32.000Z",
  eligible_count: 4,
  confirmed_count: 4,
};

const live = {
  runId: RUN_ID,
  roomRevision: 9,
  controlRevision: 6,
  playId: PLAY_ID,
  play: {
    playId: PLAY_ID,
    gameId: GAME_ID,
    questionId: QUESTION_ID,
    state: "resolved" as const,
    openedAt: play.opened_at,
    mainZeroAt: play.main_zero_at,
    finalWindowStartsAt: play.final_window_starts_at,
    finalWindowEndsAt: play.final_window_ends_at,
    finalizeAt: play.finalize_at,
    eligibleCount: 4,
    confirmedCount: 4,
  },
};

function resultEnvelope(freshlyApplied = true) {
  return {
    freshlyApplied,
    result: {
      code: "resolved",
      applied: true,
      eventKind: "play_resolved",
      runId: RUN_ID,
      gameId: GAME_ID,
      questionId: QUESTION_ID,
      playId: PLAY_ID,
      roomRevision: 9,
      controlRevision: 6,
    },
  };
}

function makeAdmin(rpcData: unknown = resultEnvelope()) {
  const rpc = vi.fn(async () => ({ data: rpcData, error: null }));
  const rows: Record<string, DbResult> = {
    nights: {
      data: {
        id: NIGHT_ID,
        room_code: "ABCDEF",
        answer_engine: "resilient_v1",
        current_run_id: RUN_ID,
        room_revision: 8,
        control_revision: 5,
      },
      error: null,
    },
    question_plays: { data: play, error: null },
  };
  return { rpc, from: vi.fn((table: string) => query(rows[table]!)) };
}

function request(body: unknown) {
  return new Request("http://test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ctx = {
  params: Promise.resolve({ code: "ABCDEF", playId: PLAY_ID }),
};

describe("POST /api/room/[code]/plays/[playId]/finalize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectionMock.projectExactLiveEvent.mockResolvedValue(live);
    broadcastMock.broadcastAppliedLiveRoomEvent.mockResolvedValue(true);
    broadcastMock.broadcastFireworks.mockResolvedValue(undefined);
  });

  it("accepts only opaque run identity and calls the database-owned finalizer", async () => {
    const admin = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/room/[code]/plays/[playId]/finalize/route");
    const response = await POST(request({ runId: RUN_ID }), ctx);
    const body = await response.json();

    expect(admin.rpc).toHaveBeenCalledWith("finalize_current_play_if_due", {
      p_room_code: "ABCDEF",
      p_run_id: RUN_ID,
      p_play_id: PLAY_ID,
    });
    expect(body).toEqual({ result: resultEnvelope().result, live });
    expect(body).not.toHaveProperty("freshlyApplied");
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).toHaveBeenCalledTimes(1);
    expect(broadcastMock.broadcastFireworks).toHaveBeenCalledTimes(1);
  });

  it("rejects caller-supplied authority fields before the RPC", async () => {
    const admin = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/room/[code]/plays/[playId]/finalize/route");

    for (const forbidden of [
      { reason: "everyone disconnected" },
      { deadline: "2026-07-19T01:00:32.000Z" },
      { playerId: "55555555-5555-5555-5555-555555555555" },
      { canonicalIndex: 1 },
      { answer: "secret" },
    ]) {
      const response = await POST(request({ runId: RUN_ID, ...forbidden }), ctx);
      expect(response.status).toBe(400);
    }
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("returns the current durable play when an old resolved check is replayed", async () => {
    const currentPlay = {
      ...play,
      id: CURRENT_PLAY_ID,
      status: "accepting",
      opened_at: "2026-07-19T01:01:00.000Z",
      main_zero_at: "2026-07-19T01:01:30.000Z",
      final_window_starts_at: null,
      final_window_ends_at: "2026-07-19T01:01:32.000Z",
      finalize_at: null,
      confirmed_count: 0,
    };
    let playRead = 0;
    const admin = {
      rpc: vi.fn(async () => ({ data: resultEnvelope(false), error: null })),
      from: vi.fn((table: string) => {
        if (table === "question_plays") {
          return query({ data: playRead++ === 0 ? play : currentPlay, error: null });
        }
        if (table === "nights") {
          return query({
            data: {
              id: NIGHT_ID,
              room_code: "ABCDEF",
              answer_engine: "resilient_v1",
              current_run_id: RUN_ID,
              room_revision: 14,
              control_revision: 9,
            },
            error: null,
          });
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/room/[code]/plays/[playId]/finalize/route");
    const response = await POST(request({ runId: RUN_ID }), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.live).toMatchObject({
      runId: RUN_ID,
      roomRevision: 14,
      controlRevision: 9,
      playId: CURRENT_PLAY_ID,
    });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
  });

  it("emits no room event or fireworks for replay, not-due, malformed, or stale projection", async () => {
    const { POST } = await import("@/app/api/room/[code]/plays/[playId]/finalize/route");

    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin(resultEnvelope(false)));
    expect((await POST(request({ runId: RUN_ID }), ctx)).status).toBe(200);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();

    vi.clearAllMocks();
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      freshlyApplied: false,
      result: {
        code: "not_due",
        applied: false,
        runId: RUN_ID,
        playId: PLAY_ID,
        roomRevision: 8,
        controlRevision: 5,
      },
    }));
    expect((await POST(request({ runId: RUN_ID }), ctx)).status).toBe(200);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();

    vi.clearAllMocks();
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin({
      freshlyApplied: true,
      result: { code: "resolved", raw: "private-db-detail" },
    }));
    const malformed = await POST(request({ runId: RUN_ID }), ctx);
    expect(malformed.status).toBe(500);
    expect(JSON.stringify(await malformed.json())).not.toContain("private-db-detail");
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();

    vi.clearAllMocks();
    projectionMock.projectExactLiveEvent.mockResolvedValue(null);
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin());
    const stale = await POST(request({ runId: RUN_ID }), ctx);
    expect(stale.status).toBe(200);
    expect(await stale.json()).toMatchObject({
      live: { runId: RUN_ID, playId: PLAY_ID },
    });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
  });

  it("keeps a committed finalization successful when broadcast delivery fails", async () => {
    const admin = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    broadcastMock.broadcastAppliedLiveRoomEvent.mockRejectedValue(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/room/[code]/plays/[playId]/finalize/route");
    const response = await POST(request({ runId: RUN_ID }), ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { code: "resolved" },
    });
    expect(warn).toHaveBeenCalledWith("public live finalize broadcast failed");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("offline");
    warn.mockRestore();
  });
});
