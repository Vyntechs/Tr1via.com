import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
const broadcastMock = vi.hoisted(() => ({
  broadcastToRoom: vi.fn(),
  broadcastFireworks: vi.fn(),
}));
const testModeMock = vi.hoisted(() => ({
  isTestModeEnabled: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);
vi.mock("@/lib/api/require-test-mode", () => testModeMock);

const QUESTION_ID = "11111111-1111-1111-1111-111111111111";
const CATEGORY_ID = "22222222-2222-2222-2222-222222222222";
const GAME_ID = "33333333-3333-3333-3333-333333333333";
const NIGHT_ID = "44444444-4444-4444-4444-444444444444";
const NOW = "2026-07-19T04:00:00.000Z";
const SENTINEL = "SENTINEL constraint answers_player_question_key";

type DbResult = {
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  error: { code?: string; message: string } | null;
};

function query(result: DbResult) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    then: (
      onFulfilled: (value: DbResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

function makeAdmin({
  playedAt = "2026-07-19T03:59:50.000Z",
  finishedAt = null,
  rpcError = null,
  freshlyResolved = true,
  answersError = null,
  requireRpcReceiver = false,
}: {
  playedAt?: string;
  finishedAt?: string | null;
  rpcError?: { code?: string; message: string } | null;
  freshlyResolved?: boolean;
  answersError?: { code?: string; message: string } | null;
  requireRpcReceiver?: boolean;
} = {}) {
  const rpc = vi.fn(async function (this: unknown, fn: string) {
    if (
      requireRpcReceiver &&
      (typeof this !== "object" || this === null || !("from" in this))
    ) {
      throw new TypeError("Supabase RPC receiver was detached");
    }
    return fn === "resolve_question_once"
      ? { data: freshlyResolved, error: rpcError }
      : { data: null, error: null };
  });
  const rows: Record<string, DbResult> = {
    questions: {
      data: {
        id: QUESTION_ID,
        category_id: CATEGORY_ID,
        correct_index: 2,
        played_at: playedAt,
        finished_at: finishedAt,
      },
      error: null,
    },
    categories: { data: { id: CATEGORY_ID, game_id: GAME_ID }, error: null },
    games: { data: { id: GAME_ID, night_id: NIGHT_ID }, error: null },
    nights: {
      data: {
        id: NIGHT_ID,
        room_code: "ABCDEF",
        theme_key: "house",
        hosts: { default_theme_key: "daylight" },
      },
      error: null,
    },
    answers: { data: answersError ? null : [], error: answersError },
  };

  return {
    rpc,
    from: vi.fn((table: string) => query(rows[table]!)),
  };
}

function request(headers?: HeadersInit) {
  return new NextRequest(
    `http://test/api/questions/${QUESTION_ID}/resolve`,
    { method: "POST", headers },
  );
}

const ctx = { params: Promise.resolve({ id: QUESTION_ID }) };

describe("POST /api/questions/[id]/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    testModeMock.isTestModeEnabled.mockReturnValue(false);
    broadcastMock.broadcastToRoom.mockResolvedValue(undefined);
    broadcastMock.broadcastFireworks.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects an anonymous resolve trigger before the authoritative answer window ends", async () => {
    const admin = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(request(), ctx);

    expect(response.status).toBe(409);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
  });

  it("allows an anonymous timer trigger once the authoritative window is due", async () => {
    const admin = makeAdmin({ playedAt: "2026-07-19T03:59:30.000Z" });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(request(), ctx);

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question_once", {
      p_question_id: QUESTION_ID,
    });
  });

  it("keeps the Supabase client receiver on the race-winning RPC call", async () => {
    const admin = makeAdmin({
      playedAt: "2026-07-19T03:59:30.000Z",
      requireRpcReceiver: true,
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(request(), ctx);

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question_once", {
      p_question_id: QUESTION_ID,
    });
  });

  it("broadcasts only a safe resolve refetch signal without player awards", async () => {
    const admin = makeAdmin({ playedAt: "2026-07-19T03:59:30.000Z" });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(request(), ctx);

    expect(response.status).toBe(200);
    expect(broadcastMock.broadcastToRoom).toHaveBeenCalledOnce();
    expect(broadcastMock.broadcastFireworks).toHaveBeenCalledOnce();
    const [roomCode, event, payload] = broadcastMock.broadcastToRoom.mock.calls[0];
    expect(roomCode).toBe("ABCDEF");
    expect(event).toBe("resolve");
    expect(payload).toMatchObject({
      questionId: QUESTION_ID,
      correctIndex: 2,
      refetch: true,
      serverNow: expect.any(String),
    });
    expect(Object.keys(payload).sort()).toEqual([
      "correctIndex",
      "questionId",
      "refetch",
      "serverNow",
    ]);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("awards");
    expect(serialized).not.toContain("playerId");
    expect(serialized).not.toContain("isCorrect");
    expect(serialized).not.toContain("awarded");
  });

  it("does not retry an ambiguously failed resolve broadcast", async () => {
    const admin = makeAdmin({ playedAt: "2026-07-19T03:59:30.000Z" });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    broadcastMock.broadcastToRoom.mockRejectedValueOnce(
      new Error("accepted but acknowledgement lost"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const responsePromise = POST(request(), ctx);
    await vi.runAllTimersAsync();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledOnce();
    expect(broadcastMock.broadcastToRoom).toHaveBeenCalledOnce();
    expect(broadcastMock.broadcastFireworks).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("broadcast resolve failed");
  });

  it("fans out a committed resolution when answer-count metadata is unavailable", async () => {
    const admin = makeAdmin({
      playedAt: "2026-07-19T03:59:30.000Z",
      answersError: { code: "XX000", message: SENTINEL },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ awardCount: 0 });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    expect(broadcastMock.broadcastToRoom).toHaveBeenCalledOnce();
    expect(broadcastMock.broadcastFireworks).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "answer count unavailable after resolve",
    );
  });

  it("preserves idempotent success for an already-resolved question", async () => {
    const admin = makeAdmin({
      playedAt: "2026-07-19T03:59:30.000Z",
      finishedAt: "2026-07-19T04:00:00.000Z",
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(request(), ctx);

    expect(response.status).toBe(200);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
  });

  it("lets a concurrent RPC loser succeed without rebroadcasting", async () => {
    const admin = makeAdmin({
      playedAt: "2026-07-19T03:59:30.000Z",
      freshlyResolved: false,
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ alreadyResolved: true });
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question_once", {
      p_question_id: QUESTION_ID,
    });
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
  });

  it("keeps fast-forward available only when the existing test-mode gate approves the request", async () => {
    const admin = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    testModeMock.isTestModeEnabled.mockReturnValue(true);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(
      request({ "x-test-secret": "test-only-secret" }),
      ctx,
    );

    expect(response.status).toBe(200);
    expect(testModeMock.isTestModeEnabled).toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question_once", {
      p_question_id: QUESTION_ID,
    });
  });

  it("falls back to the existing resolver only when PostgREST cannot find the new RPC", async () => {
    const admin = makeAdmin({
      playedAt: "2026-07-19T03:59:30.000Z",
      rpcError: {
        code: "PGRST202",
        message: "Could not find the function in the schema cache",
      },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(request(), ctx);

    expect(response.status).toBe(200);
    expect(admin.rpc.mock.calls).toEqual([
      ["resolve_question_once", { p_question_id: QUESTION_ID }],
      ["resolve_question", { p_question_id: QUESTION_ID }],
    ]);
    expect(broadcastMock.broadcastToRoom).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "resolve_question_once is unavailable (PGRST202); falling back to resolve_question until the migration is applied",
    );
  });

  it("never exposes a resolve RPC database error", async () => {
    const admin = makeAdmin({
      playedAt: "2026-07-19T03:59:30.000Z",
      rpcError: { code: "42501", message: SENTINEL },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "server error" });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
    expect(admin.rpc).toHaveBeenCalledOnce();
    expect(admin.rpc).not.toHaveBeenCalledWith("resolve_question", {
      p_question_id: QUESTION_ID,
    });
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
  });
});
