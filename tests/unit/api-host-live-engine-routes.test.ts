import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({
  requireOwnedGame: vi.fn(),
  requireOwnedNight: vi.fn(),
}));
const projectMock = vi.hoisted(() => ({ projectExactLiveEvent: vi.fn() }));
const broadcastMock = vi.hoisted(() => ({
  broadcastAppliedLiveRoomEvent: vi.fn(),
  broadcastToRoom: vi.fn(),
  broadcastGameStarted: vi.fn(),
  broadcastGameEnded: vi.fn(),
  broadcastFireworks: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/live-answer/projectEvent", () => projectMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const GAME_ID = "22222222-2222-2222-2222-222222222222";
const QUESTION_ID = "33333333-3333-3333-3333-333333333333";
const RUN_ID = "44444444-4444-4444-4444-444444444444";
const PLAY_ID = "55555555-5555-5555-5555-555555555555";
const COMMAND_ID = "66666666-6666-6666-6666-666666666666";

const commandBody = {
  runId: RUN_ID,
  commandId: COMMAND_ID,
  expectedControlRevision: 4,
};
const playBody = { ...commandBody, playId: PLAY_ID };

function gameContext() {
  return { params: Promise.resolve({ id: GAME_ID }) };
}

function nightContext() {
  return { params: Promise.resolve({ id: NIGHT_ID }) };
}

function request(path: string, body?: unknown) {
  return new NextRequest(`http://test${path}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function envelope(result: Record<string, unknown>, freshlyApplied = true) {
  return { freshlyApplied, result };
}

function adminReturning(data: unknown) {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
    from: vi.fn(() => {
      throw new Error("resilient route must not use legacy table mutations");
    }),
  };
}

function applied(eventKind: string, extra: Record<string, unknown> = {}) {
  return {
    code: "applied",
    applied: true,
    eventKind,
    runId: RUN_ID,
    roomRevision: 8,
    controlRevision: 5,
    ...extra,
  };
}

function legacyStartAdmin(
  state: "ready" | "live" = "ready",
  updateError: { message: string } | null = null,
) {
  const updateEq = vi.fn(async () => ({ error: updateError }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const existing = {
    select: vi.fn(() => existing),
    eq: vi.fn(() => existing),
    single: vi.fn(async () => ({ data: { state }, error: null })),
  };
  const categories = {
    select: vi.fn(() => categories),
    eq: vi.fn(() => categories),
    then: (resolve: (value: { count: number; error: null }) => unknown) =>
      Promise.resolve({ count: 1, error: null }).then(resolve),
  };
  const admin = {
    rpc: vi.fn(),
    from: vi.fn((table: string) => {
      if (table === "games") return { ...existing, update };
      if (table === "categories") return categories;
      throw new Error(`unexpected legacy start table: ${table}`);
    }),
  };
  return { admin, update };
}

describe("resilient host lifecycle routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const night = {
      id: NIGHT_ID,
      room_code: "ABCDEF",
      answer_engine: "resilient_v1",
      current_run_id: RUN_ID,
      room_revision: 7,
      control_revision: 4,
    };
    authMock.requireOwnedGame.mockResolvedValue({
      ok: true,
      host: { id: "host" },
      night,
      gameId: GAME_ID,
    });
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: "host" },
      night,
    });
    projectMock.projectExactLiveEvent.mockResolvedValue({
      runId: RUN_ID,
      roomRevision: 8,
      controlRevision: 5,
      playId: PLAY_ID,
      play: null,
    });
    broadcastMock.broadcastAppliedLiveRoomEvent.mockResolvedValue(true);
    broadcastMock.broadcastFireworks.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("starts a game through exactly one authoritative RPC and broadcasts the fresh winner", async () => {
    const result = applied("game_started", { gameId: GAME_ID });
    const admin = adminReturning(envelope(result));
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/start/route");
    const response = await POST(request(`/api/games/${GAME_ID}/start`, commandBody), gameContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("start_live_game", {
      p_game_id: GAME_ID,
      p_run_id: RUN_ID,
      p_command_id: COMMAND_ID,
      p_expected_control_revision: 4,
    });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).toHaveBeenCalledTimes(1);
    expect(broadcastMock.broadcastGameStarted).not.toHaveBeenCalled();
  });

  it("opens a question play through the authoritative reveal RPC", async () => {
    const result = applied("play_opened", {
      gameId: GAME_ID,
      questionId: QUESTION_ID,
      playId: PLAY_ID,
    });
    const admin = adminReturning(envelope(result));
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/reveal/route");
    const response = await POST(request(`/api/games/${GAME_ID}/reveal`, {
      ...commandBody,
      questionId: QUESTION_ID,
    }), gameContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(admin.rpc).toHaveBeenCalledWith("open_question_play", {
      p_game_id: GAME_ID,
      p_question_id: QUESTION_ID,
      p_run_id: RUN_ID,
      p_command_id: COMMAND_ID,
      p_expected_control_revision: 4,
    });
  });

  it.each([
    ["final_window_started", applied("final_window_started", { playId: PLAY_ID })],
    ["play_resolved", {
      code: "resolved",
      applied: true,
      eventKind: "play_resolved",
      runId: RUN_ID,
      playId: PLAY_ID,
      roomRevision: 8,
      controlRevision: 5,
    }],
  ])("accepts %s from Show Answer without calling legacy resolution", async (_kind, result) => {
    const admin = adminReturning(envelope(result));
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    if (_kind === "play_resolved") {
      projectMock.projectExactLiveEvent.mockResolvedValueOnce({
        runId: RUN_ID,
        roomRevision: 8,
        controlRevision: 5,
        playId: PLAY_ID,
        play: { questionId: QUESTION_ID },
      });
    }

    const { POST } = await import("@/app/api/games/[id]/end-early/route");
    const response = await POST(
      request(`/api/games/${GAME_ID}/end-early`, playBody),
      gameContext(),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("begin_question_play_final_window", {
      p_game_id: GAME_ID,
      p_play_id: PLAY_ID,
      p_run_id: RUN_ID,
      p_command_id: COMMAND_ID,
      p_expected_control_revision: 4,
    });
    expect(admin.rpc).not.toHaveBeenCalledWith("resolve_question", expect.anything());
    if (_kind === "play_resolved") {
      expect(broadcastMock.broadcastFireworks).toHaveBeenCalledTimes(1);
      expect(broadcastMock.broadcastFireworks).toHaveBeenCalledWith(
        "ABCDEF",
        "salvo",
        QUESTION_ID,
      );
    } else {
      expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
    }
  });

  it("does not repeat the resolved-question salvo for a nonfresh Show Answer retry", async () => {
    const result = {
      code: "resolved",
      applied: true,
      eventKind: "play_resolved",
      runId: RUN_ID,
      playId: PLAY_ID,
      roomRevision: 8,
      controlRevision: 5,
    };
    adminMock.getSupabaseAdmin.mockReturnValue(adminReturning(envelope(result, false)));

    const { POST } = await import("@/app/api/games/[id]/end-early/route");
    const response = await POST(
      request(`/api/games/${GAME_ID}/end-early`, playBody),
      gameContext(),
    );
    expect(response.status).toBe(200);
    expect(projectMock.projectExactLiveEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
  });

  it("undoes the exact accepted play through one authoritative RPC", async () => {
    const result = applied("play_undone", { playId: PLAY_ID });
    const admin = adminReturning(envelope(result));
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/undo/route");
    const response = await POST(request(`/api/games/${GAME_ID}/undo`, playBody), gameContext());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(admin.rpc).toHaveBeenCalledWith("undo_question_play", {
      p_game_id: GAME_ID,
      p_play_id: PLAY_ID,
      p_run_id: RUN_ID,
      p_command_id: COMMAND_ID,
      p_expected_control_revision: 4,
    });
  });

  it("gates game-end broadcasts and fireworks to the fresh transaction winner", async () => {
    const result = applied("game_ended", { gameId: GAME_ID });
    adminMock.getSupabaseAdmin.mockReturnValue(adminReturning(envelope(result, false)));

    const { POST } = await import("@/app/api/games/[id]/end/route");
    const response = await POST(request(`/api/games/${GAME_ID}/end`, commandBody), gameContext());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(projectMock.projectExactLiveEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastGameEnded).not.toHaveBeenCalled();
  });

  it("sends the authoritative game-end event and finale cosmetic for a fresh winner", async () => {
    const result = applied("game_ended", { gameId: GAME_ID });
    adminMock.getSupabaseAdmin.mockReturnValue(adminReturning(envelope(result)));

    const { POST } = await import("@/app/api/games/[id]/end/route");
    const response = await POST(request(`/api/games/${GAME_ID}/end`, commandBody), gameContext());
    expect(response.status).toBe(200);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).toHaveBeenCalledTimes(1);
    expect(broadcastMock.broadcastFireworks).toHaveBeenCalledWith("ABCDEF", "finale");
    expect(broadcastMock.broadcastGameEnded).not.toHaveBeenCalled();
  });

  it("never rebroadcasts an archived reset replay", async () => {
    const result = applied("night_reset", { previousRunId: RUN_ID });
    adminMock.getSupabaseAdmin.mockReturnValue(adminReturning(envelope(result, false)));

    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const response = await POST(
      request(`/api/nights/${NIGHT_ID}/reset-to-setup`, commandBody),
      nightContext(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(projectMock.projectExactLiveEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("broadcasts one authoritative reset event for the fresh winner", async () => {
    const result = applied("night_reset", { previousRunId: RUN_ID });
    adminMock.getSupabaseAdmin.mockReturnValue(adminReturning(envelope(result)));

    const { POST } = await import("@/app/api/nights/[id]/reset-to-setup/route");
    const response = await POST(
      request(`/api/nights/${NIGHT_ID}/reset-to-setup`, commandBody),
      nightContext(),
    );
    expect(response.status).toBe(200);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed resilient results without broadcasting", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(adminReturning({
      freshlyApplied: true,
      result: { ...applied("play_undone", { playId: PLAY_ID }), playerId: "private" },
    }));

    const { POST } = await import("@/app/api/games/[id]/undo/route");
    const response = await POST(request(`/api/games/${GAME_ID}/undo`, playBody), gameContext());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "could not update live game" });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("rejects a valid envelope for the wrong host command kind", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(adminReturning(envelope(
      applied("game_started", { gameId: GAME_ID }),
    )));

    const { POST } = await import("@/app/api/games/[id]/undo/route");
    const response = await POST(request(`/api/games/${GAME_ID}/undo`, playBody), gameContext());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "could not update live game" });
    expect(projectMock.projectExactLiveEvent).not.toHaveBeenCalled();
  });

  it("keeps a committed mutation successful if fast fan-out fails", async () => {
    const result = applied("game_started", { gameId: GAME_ID });
    adminMock.getSupabaseAdmin.mockReturnValue(adminReturning(envelope(result)));
    broadcastMock.broadcastAppliedLiveRoomEvent.mockRejectedValueOnce(new Error("offline"));

    const { POST } = await import("@/app/api/games/[id]/start/route");
    const response = await POST(request(`/api/games/${GAME_ID}/start`, commandBody), gameContext());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(console.warn).toHaveBeenCalledWith("broadcast game-started failed");
  });
});

describe("legacy game start convergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    authMock.requireOwnedGame.mockResolvedValue({
      ok: true,
      host: { id: "host" },
      night: {
        id: NIGHT_ID,
        room_code: "ABCDEF",
        answer_engine: "legacy",
      },
      gameId: GAME_ID,
    });
    broadcastMock.broadcastGameStarted.mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("broadcasts one game-level wake-up after the legacy start commits", async () => {
    const { admin } = legacyStartAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/start/route");
    const response = await POST(request(`/api/games/${GAME_ID}/start`), gameContext());

    expect(response.status).toBe(200);
    expect(broadcastMock.broadcastGameStarted).toHaveBeenCalledWith("ABCDEF", GAME_ID);
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("keeps a committed legacy start successful when the wake-up broadcast fails", async () => {
    const { admin } = legacyStartAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    broadcastMock.broadcastGameStarted.mockRejectedValueOnce(new Error("offline"));

    const { POST } = await import("@/app/api/games/[id]/start/route");
    const response = await POST(request(`/api/games/${GAME_ID}/start`), gameContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "live" });
    expect(console.warn).toHaveBeenCalledWith("broadcast legacy game-started failed");
  });

  it("retries the wake-up without rewriting an already-live legacy game", async () => {
    const { admin, update } = legacyStartAdmin("live");
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/start/route");
    const response = await POST(request(`/api/games/${GAME_ID}/start`), gameContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "live" });
    expect(update).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastGameStarted).toHaveBeenCalledWith("ABCDEF", GAME_ID);
  });

  it("does not broadcast when the legacy game update fails", async () => {
    const { admin } = legacyStartAdmin("ready", { message: "write failed" });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/start/route");
    const response = await POST(request(`/api/games/${GAME_ID}/start`), gameContext());

    expect(response.status).toBe(500);
    expect(broadcastMock.broadcastGameStarted).not.toHaveBeenCalled();
  });
});
