import { beforeEach, describe, expect, it, vi } from "vitest";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const projectionMock = vi.hoisted(() => ({ projectExactLiveEvent: vi.fn() }));
const broadcastMock = vi.hoisted(() => ({
  broadcastAppliedLiveRoomEvent: vi.fn(),
  broadcastToRoom: vi.fn(),
  broadcastFireworks: vi.fn(),
}));
const testModeMock = vi.hoisted(() => ({ isTestModeEnabled: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/live-answer/projectEvent", () => projectionMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);
vi.mock("@/lib/api/require-test-mode", () => testModeMock);

const QUESTION_ID = "11111111-1111-1111-1111-111111111111";
const CATEGORY_ID = "22222222-2222-2222-2222-222222222222";
const GAME_ID = "33333333-3333-3333-3333-333333333333";
const NIGHT_ID = "44444444-4444-4444-4444-444444444444";
const PLAY_ID = "77777777-7777-4777-8777-777777777777";
const RUN_ID = "88888888-8888-8888-8888-888888888888";

type DbResult = { data: unknown; error: { message: string } | null };

function query(result: DbResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    then: (
      onFulfilled: (value: DbResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
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
  eligible_count: 3,
  confirmed_count: 2,
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
    eligibleCount: 3,
    confirmedCount: 2,
  },
};

function resolvedEnvelope(freshlyApplied: boolean) {
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

function makeAdmin(rpcData: unknown) {
  const rpc = vi.fn(async () => ({ data: rpcData, error: null }));
  let playRead = 0;
  const rows: Record<string, DbResult> = {
    questions: {
      data: {
        id: QUESTION_ID,
        category_id: CATEGORY_ID,
        correct_index: 2,
        played_at: "2026-07-19T01:00:00.000Z",
        finished_at: null,
      },
      error: null,
    },
    categories: { data: { game_id: GAME_ID }, error: null },
    games: { data: { id: GAME_ID, night_id: NIGHT_ID }, error: null },
    nights: {
      data: {
        id: NIGHT_ID,
        room_code: "ABCDEF",
        theme_key: "house",
        hosts: { default_theme_key: "house" },
        answer_engine: "resilient_v1",
        current_run_id: RUN_ID,
        room_revision: 8,
        control_revision: 5,
      },
      error: null,
    },
  };
  return {
    rpc,
    from: vi.fn((table: string) =>
      table === "question_plays"
        ? query({ data: playRead++ === 0 ? [play] : play, error: null })
        : query(rows[table]!),
    ),
  };
}

const ctx = { params: Promise.resolve({ id: QUESTION_ID }) };

describe("resilient POST /api/questions/[id]/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    testModeMock.isTestModeEnabled.mockReturnValue(false);
    projectionMock.projectExactLiveEvent.mockResolvedValue(live);
    broadcastMock.broadcastAppliedLiveRoomEvent.mockResolvedValue(true);
    broadcastMock.broadcastFireworks.mockResolvedValue(undefined);
  });

  it("delegates only to the authoritative due-finalizer and broadcasts a fresh resolution", async () => {
    const admin = makeAdmin(resolvedEnvelope(true));
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(new Request("http://test"), ctx);
    const body = await response.json();

    expect(admin.rpc).toHaveBeenCalledWith("finalize_current_play_if_due", {
      p_room_code: "ABCDEF",
      p_run_id: RUN_ID,
      p_play_id: PLAY_ID,
    });
    expect(admin.rpc).not.toHaveBeenCalledWith("resolve_question", expect.anything());
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).toHaveBeenCalledWith(
      "ABCDEF",
      expect.objectContaining({ kind: "play_resolved", live }),
    );
    expect(broadcastMock.broadcastFireworks).toHaveBeenCalledTimes(1);
    expect(body).toEqual({ result: resolvedEnvelope(true).result, live });
    expect(body).not.toHaveProperty("freshlyApplied");
  });

  it("records the resilient due-finalizer through the safe server sink", async () => {
    const admin = makeAdmin(resolvedEnvelope(true));
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(new Request("http://test"), ctx);

    expect(response.status).toBe(200);
    expect(info).toHaveBeenCalledOnce();
    expect(info.mock.calls[0][0]).toMatchObject({
      event: "live_answer_health",
      playId: PLAY_ID,
      resultCode: "resolved",
      resolutionReason: "timer",
    });
    info.mockRestore();
  });

  it("does not broadcast or fire fireworks for a replay, not-due result, or stale projection", async () => {
    const replay = makeAdmin(resolvedEnvelope(false));
    adminMock.getSupabaseAdmin.mockReturnValue(replay);
    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const replayResponse = await POST(new Request("http://test"), ctx);
    expect(replayResponse.status).toBe(200);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();

    vi.clearAllMocks();
    testModeMock.isTestModeEnabled.mockReturnValue(false);
    const notDue = makeAdmin({
      freshlyApplied: false,
      result: {
        code: "not_due",
        applied: false,
        runId: RUN_ID,
        playId: PLAY_ID,
        roomRevision: 8,
        controlRevision: 5,
      },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(notDue);
    await POST(new Request("http://test"), ctx);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();

    vi.clearAllMocks();
    testModeMock.isTestModeEnabled.mockReturnValue(false);
    projectionMock.projectExactLiveEvent.mockResolvedValue(null);
    const staleProjection = makeAdmin(resolvedEnvelope(true));
    adminMock.getSupabaseAdmin.mockReturnValue(staleProjection);
    const staleResponse = await POST(new Request("http://test"), ctx);
    expect(staleResponse.status).toBe(200);
    expect(await staleResponse.json()).toMatchObject({
      live: { runId: RUN_ID, playId: PLAY_ID },
    });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
  });

  it("maps a fresh final-window transition without resolution fireworks", async () => {
    const result = {
      code: "final_window",
      applied: true,
      eventKind: "final_window_started",
      runId: RUN_ID,
      gameId: GAME_ID,
      questionId: QUESTION_ID,
      playId: PLAY_ID,
      roomRevision: 9,
      controlRevision: 6,
    };
    const admin = makeAdmin({ freshlyApplied: true, result });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(new Request("http://test"), ctx);

    expect(response.status).toBe(200);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).toHaveBeenCalledWith(
      "ABCDEF",
      expect.objectContaining({ kind: "final_window_started" }),
    );
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
  });

  it("reprojects durable state after a nonwinning due check", async () => {
    const resolvedPlay = { ...play, status: "resolved" };
    let playRead = 0;
    const rows: Record<string, DbResult> = {
      questions: {
        data: {
          id: QUESTION_ID,
          category_id: CATEGORY_ID,
          correct_index: 2,
          played_at: "2026-07-19T01:00:00.000Z",
          finished_at: "2026-07-19T01:00:32.000Z",
        },
        error: null,
      },
      categories: { data: { game_id: GAME_ID }, error: null },
      games: { data: { id: GAME_ID, night_id: NIGHT_ID }, error: null },
      nights: {
        data: {
          id: NIGHT_ID,
          room_code: "ABCDEF",
          theme_key: "house",
          hosts: { default_theme_key: "house" },
          answer_engine: "resilient_v1",
          current_run_id: RUN_ID,
          room_revision: 10,
          control_revision: 7,
        },
        error: null,
      },
    };
    const admin = {
      rpc: vi.fn(async () => ({
        data: {
          freshlyApplied: false,
          result: {
            code: "not_due",
            applied: false,
            runId: RUN_ID,
            playId: PLAY_ID,
            roomRevision: 8,
            controlRevision: 5,
          },
        },
        error: null,
      })),
      from: vi.fn((table: string) => {
        if (table === "question_plays") {
          return query({
            data: playRead++ === 0 ? [play] : resolvedPlay,
            error: null,
          });
        }
        return query(rows[table]!);
      }),
    };
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(new Request("http://test"), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.live).toMatchObject({
      roomRevision: 10,
      controlRevision: 7,
      playId: PLAY_ID,
      play: { state: "resolved" },
    });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed envelope without exposing database detail", async () => {
    const admin = makeAdmin({
      freshlyApplied: true,
      result: { code: "resolved", rawDatabaseMessage: "private-host" },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(new Request("http://test"), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "server error" });
    expect(JSON.stringify(body)).not.toContain("private-host");
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });
});
