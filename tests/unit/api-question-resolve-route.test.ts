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
}: {
  playedAt?: string;
  finishedAt?: string | null;
  rpcError?: { message: string } | null;
} = {}) {
  const rpc = vi.fn(async () => ({ data: null, error: rpcError }));
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
    answers: { data: [], error: null },
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
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question", {
      p_question_id: QUESTION_ID,
    });
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
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question", {
      p_question_id: QUESTION_ID,
    });
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
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question", {
      p_question_id: QUESTION_ID,
    });
  });

  it("never exposes a resolve RPC database error", async () => {
    const admin = makeAdmin({
      playedAt: "2026-07-19T03:59:30.000Z",
      rpcError: { message: SENTINEL },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/questions/[id]/resolve/route");
    const response = await POST(request(), ctx);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "server error" });
    expect(JSON.stringify(body)).not.toContain(SENTINEL);
  });
});
