import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ getDeviceId: vi.fn() }));
const projectionMock = vi.hoisted(() => ({
  projectExactLiveEvent: vi.fn(),
}));
const broadcastMock = vi.hoisted(() => ({
  broadcastAppliedLiveRoomEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/live-answer/projectEvent", () => projectionMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const QUESTION_ID = "11111111-1111-1111-1111-111111111111";
const CATEGORY_ID = "22222222-2222-2222-2222-222222222222";
const GAME_ID = "33333333-3333-3333-3333-333333333333";
const NIGHT_ID = "44444444-4444-4444-4444-444444444444";
const PLAYER_ID = "55555555-5555-5555-5555-555555555555";
const DEVICE_ID = "66666666-6666-6666-6666-666666666666";
const PLAY_ID = "77777777-7777-4777-8777-777777777777";
const RUN_ID = "88888888-8888-8888-8888-888888888888";
const SUBMISSION_ID = "99999999-9999-4999-8999-999999999999";
const CURRENT_PLAY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type DbResult = { data: unknown; error: { code?: string; message: string } | null };

function query(result: DbResult) {
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

const live = {
  runId: RUN_ID,
  roomRevision: 8,
  controlRevision: 5,
  playId: PLAY_ID,
  play: {
    playId: PLAY_ID,
    gameId: GAME_ID,
    questionId: QUESTION_ID,
    state: "accepting" as const,
    openedAt: play.opened_at,
    mainZeroAt: play.main_zero_at,
    finalWindowStartsAt: null,
    finalWindowEndsAt: play.final_window_ends_at,
    finalizeAt: null,
    eligibleCount: 3,
    confirmedCount: 2,
  },
};

function confirmedEnvelope(freshlyApplied: boolean) {
  return {
    freshlyApplied,
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
  };
}

function claimedEnvelope(duplicate = false) {
  return {
    freshlyApplied: !duplicate,
    result: {
      code: "claimed",
      duplicate,
      runId: RUN_ID,
      playId: PLAY_ID,
    },
  };
}

function resilientAdmin(
  rpcData: unknown | unknown[] = [
    claimedEnvelope(false),
    confirmedEnvelope(true),
  ],
  rpcError: { message: string } | null = null,
) {
  const results = Array.isArray(rpcData) ? [...rpcData] : [rpcData];
  const rpc = vi.fn(async () => ({
    data: results.shift() ?? null,
    error: rpcError,
  }));
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
  return {
    rpc,
    from: vi.fn((table: string) => query(rows[table]!)),
  };
}

function post(body: unknown) {
  return new NextRequest("http://test/api/answers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/answers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    projectionMock.projectExactLiveEvent.mockResolvedValue(live);
    broadcastMock.broadcastAppliedLiveRoomEvent.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves the legacy answer path and response", async () => {
    const insert = vi.fn(async () => ({ data: null, error: null }));
    const rows: Record<string, DbResult> = {
      questions: {
        data: {
          id: QUESTION_ID,
          category_id: CATEGORY_ID,
          played_at: "2026-07-19T01:00:00.000Z",
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
    const admin = {
      rpc: vi.fn(),
      from: vi.fn((table: string) =>
        table === "answers" ? { insert } : query(rows[table]!),
      ),
    };
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { scrambleFor } = await import("@/lib/game/scramble");
    const { POST } = await import("@/app/api/answers/route");
    const response = await POST(post({
      questionId: QUESTION_ID,
      slotChosen: 1,
      scramble: scrambleFor(QUESTION_ID, PLAYER_ID),
    }));

    expect(response.status).toBe(204);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("rejects forbidden resilient identity and answer fields before mutation", async () => {
    const admin = resilientAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/answers/route");
    for (const forbidden of [
      { playerId: PLAYER_ID },
      { deviceId: DEVICE_ID },
      { canonicalIndex: 1 },
      { answerKey: 2 },
      { deadline: "2026-07-19T01:00:32.000Z" },
      { scramble: [0, 1, 2, 3] },
    ]) {
      const response = await POST(post({
        playId: PLAY_ID,
        runId: RUN_ID,
        submissionId: SUBMISSION_ID,
        slotChosen: 3,
        ...forbidden,
      }));
      expect(response.status).toBe(400);
    }

    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("uses only the verified signed-cookie device and returns the canonical confirmation", async () => {
    const admin = resilientAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/answers/route");
    const response = await POST(post({
      playId: PLAY_ID,
      runId: RUN_ID,
      submissionId: SUBMISSION_ID,
      slotChosen: 3,
    }));
    const body = await response.json();

    expect(admin.rpc).toHaveBeenNthCalledWith(1, "claim_question_play_answer", {
      p_play_id: PLAY_ID,
      p_run_id: RUN_ID,
      p_submission_id: SUBMISSION_ID,
      p_verified_device_id: DEVICE_ID,
      p_visible_slot: 3,
    });
    expect(admin.rpc).toHaveBeenNthCalledWith(
      2,
      "apply_claimed_question_play_answer",
      {
        p_play_id: PLAY_ID,
        p_run_id: RUN_ID,
        p_verified_device_id: DEVICE_ID,
      },
    );
    expect(body).toEqual({
      code: "confirmed",
      confirmedSlot: 3,
      duplicate: false,
      live,
    });
    expect(body).not.toHaveProperty("freshlyApplied");
    expect(JSON.stringify(body)).not.toContain(DEVICE_ID);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).toHaveBeenCalledTimes(1);
  });

  it("returns the same confirmation after a weak-network retry without rebroadcasting", async () => {
    const admin = resilientAdmin([
      claimedEnvelope(true),
      confirmedEnvelope(false),
    ]);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/answers/route");
    const response = await POST(post({
      playId: PLAY_ID,
      runId: RUN_ID,
      submissionId: SUBMISSION_ID,
      slotChosen: 3,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      code: "confirmed",
      confirmedSlot: 3,
      duplicate: true,
      live: { runId: RUN_ID, playId: PLAY_ID },
    });
    expect(projectionMock.projectExactLiveEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("reconciles an old-play retry to the current durable room projection", async () => {
    const currentPlay = {
      ...play,
      id: CURRENT_PLAY_ID,
      opened_at: "2026-07-19T01:01:00.000Z",
      main_zero_at: "2026-07-19T01:01:30.000Z",
      final_window_ends_at: "2026-07-19T01:01:32.000Z",
      confirmed_count: 0,
    };
    let playRead = 0;
    const rpc = vi.fn(async () => ({
      data: [claimedEnvelope(true), confirmedEnvelope(false)][rpc.mock.calls.length - 1],
      error: null,
    }));
    const admin = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === "question_plays") {
          return query({ data: playRead++ === 0 ? play : currentPlay, error: null });
        }
        if (table === "nights") {
          return query({
            data: {
              id: NIGHT_ID,
              answer_engine: "resilient_v1",
              current_run_id: RUN_ID,
              room_code: "ABCDEF",
              room_revision: 12,
              control_revision: 8,
            },
            error: null,
          });
        }
        throw new Error(`unexpected table ${table}`);
      }),
    };
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/answers/route");
    const response = await POST(post({
      playId: PLAY_ID,
      runId: RUN_ID,
      submissionId: SUBMISSION_ID,
      slotChosen: 3,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.live).toMatchObject({
      runId: RUN_ID,
      roomRevision: 12,
      controlRevision: 8,
      playId: CURRENT_PLAY_ID,
    });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("never broadcasts malformed, nonwinner, or stale exact projections", async () => {
    const malformed = resilientAdmin([
      claimedEnvelope(false),
      { freshlyApplied: true, result: { code: "confirmed" } },
    ]);
    adminMock.getSupabaseAdmin.mockReturnValue(malformed);
    const { POST } = await import("@/app/api/answers/route");
    const bad = await POST(post({
      playId: PLAY_ID,
      runId: RUN_ID,
      submissionId: SUBMISSION_ID,
      slotChosen: 3,
    }));
    expect(bad.status).toBe(500);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();

    vi.clearAllMocks();
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    const nonwinner = resilientAdmin({
      freshlyApplied: false,
      result: { code: "deadline_passed" },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(nonwinner);
    const late = await POST(post({
      playId: PLAY_ID,
      runId: RUN_ID,
      submissionId: SUBMISSION_ID,
      slotChosen: 3,
    }));
    expect(await late.json()).toEqual({ code: "deadline_passed" });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();

    vi.clearAllMocks();
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    projectionMock.projectExactLiveEvent.mockResolvedValue(null);
    const stale = resilientAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(stale);
    const confirmed = await POST(post({
      playId: PLAY_ID,
      runId: RUN_ID,
      submissionId: SUBMISSION_ID,
      slotChosen: 3,
    }));
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({
      code: "confirmed",
      live: { runId: RUN_ID, playId: PLAY_ID },
    });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("does not fail a committed answer when best-effort broadcast fails", async () => {
    vi.useFakeTimers();
    const admin = resilientAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    broadcastMock.broadcastAppliedLiveRoomEvent.mockImplementation(
      () => new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("offline")), 750);
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/answers/route");
    let settled = false;
    const responsePromise = POST(post({
      playId: PLAY_ID,
      runId: RUN_ID,
      submissionId: SUBMISSION_ID,
      slotChosen: 3,
    })).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(749);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: "confirmed" });
    expect(warn).toHaveBeenCalledWith("live answer broadcast failed");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("offline");
    warn.mockRestore();
  });

  it("emits only allowlisted structured health telemetry", async () => {
    const admin = resilientAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/answers/route");
    const response = await POST(post({
      playId: PLAY_ID,
      runId: RUN_ID,
      submissionId: SUBMISSION_ID,
      slotChosen: 3,
    }));

    expect(response.status).toBe(200);
    expect(info).toHaveBeenCalledOnce();
    const logged = info.mock.calls[0][0] as Record<string, unknown>;
    expect(logged).toMatchObject({
      event: "live_answer_health",
      playId: PLAY_ID,
      resultCode: "confirmed",
      duplicateCount: 0,
    });
    expect(Object.keys(logged).sort()).toEqual([
      "duplicateCount",
      "event",
      "latencyBucket",
      "playId",
      "resultCode",
    ]);
    const serialized = JSON.stringify(logged);
    expect(serialized).not.toContain("ABCDEF");
    expect(serialized).not.toContain(PLAYER_ID);
    expect(serialized).not.toContain(DEVICE_ID);
    expect(serialized).not.toContain(SUBMISSION_ID);
    expect(serialized).not.toContain("slotChosen");
    info.mockRestore();
  });

  it("keeps a committed answer successful when the server log sink throws", async () => {
    const admin = resilientAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const info = vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("server logger unavailable");
    });

    const { POST } = await import("@/app/api/answers/route");
    const response = await POST(post({
      playId: PLAY_ID,
      runId: RUN_ID,
      submissionId: SUBMISSION_ID,
      slotChosen: 3,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: "confirmed" });
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
  });

  it("rejects a missing or invalid signed device before any database access", async () => {
    const admin = resilientAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    authMock.getDeviceId.mockResolvedValue(null);

    const { POST } = await import("@/app/api/answers/route");
    const response = await POST(post({
      playId: PLAY_ID,
      runId: RUN_ID,
      submissionId: SUBMISSION_ID,
      slotChosen: 3,
    }));

    expect(response.status).toBe(401);
    expect(admin.from).not.toHaveBeenCalled();
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
