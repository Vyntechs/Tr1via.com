import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedGame: vi.fn() }));
const broadcastMock = vi.hoisted(() => ({
  broadcastToRoom: vi.fn(),
  broadcastAppliedLiveRoomEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const QUESTION_ID = "22222222-2222-2222-2222-222222222222";
const NOW = "2026-07-19T04:00:00.000Z";

function makeAdmin({
  occurredAt = "2026-07-19T03:59:59.000Z",
  finishedAt = null,
  questionError = null,
}: {
  occurredAt?: string;
  finishedAt?: string | null;
  questionError?: { message: string } | null;
} = {}) {
  const reveals = {
    select: vi.fn(() => reveals),
    eq: vi.fn(() => reveals),
    order: vi.fn(() => reveals),
    limit: vi.fn(() => reveals),
    maybeSingle: vi.fn(async () => ({
      data: {
        id: "reveal-1",
        question_id: QUESTION_ID,
        occurred_at: occurredAt,
        event: "reveal",
      },
      error: null,
    })),
    insert: vi.fn(async () => ({ error: null })),
  };
  const questionUpdateEq = vi.fn(async () => ({ error: null }));
  const questions = {
    select: vi.fn(() => questions),
    eq: vi.fn(() => questions),
    maybeSingle: vi.fn(async () => ({
      data: questionError ? null : { finished_at: finishedAt },
      error: questionError,
    })),
    update: vi.fn(() => ({ eq: questionUpdateEq })),
  };
  const answersDeleteEq = vi.fn(async () => ({ error: null }));
  const answers = { delete: vi.fn(() => ({ eq: answersDeleteEq })) };
  const tables: Record<string, unknown> = { reveals, questions, answers };
  return {
    reveals,
    questions,
    answers,
    from: vi.fn((table: string) => tables[table]),
    rpc: vi.fn(),
  };
}

async function post(admin: ReturnType<typeof makeAdmin>) {
  adminMock.getSupabaseAdmin.mockReturnValue(admin);
  const { POST } = await import("@/app/api/games/[id]/undo/route");
  return POST(
    new Request(`http://test/api/games/${GAME_ID}/undo`, { method: "POST" }),
    { params: Promise.resolve({ id: GAME_ID }) },
  );
}

function expectNothingChanged(admin: ReturnType<typeof makeAdmin>) {
  expect(admin.reveals.insert).not.toHaveBeenCalled();
  expect(admin.answers.delete).not.toHaveBeenCalled();
  expect(admin.questions.update).not.toHaveBeenCalled();
  expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
}

describe("POST /api/games/[id]/undo on a legacy night", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    authMock.requireOwnedGame.mockResolvedValue({
      ok: true,
      night: { id: "night-1", room_code: "ABCDEF", answer_engine: "legacy" },
    });
    broadcastMock.broadcastToRoom.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a question that already closed, changing nothing", async () => {
    const admin = makeAdmin({ finishedAt: "2026-07-19T03:59:59.500Z" });

    const res = await post(admin);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "question is already resolved" });
    expectNothingChanged(admin);
  });

  it("still undoes an open question inside the window", async () => {
    const admin = makeAdmin();

    const res = await post(admin);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ undoneQuestionId: QUESTION_ID });
    expect(admin.questions.update).toHaveBeenCalledWith({
      played_at: null,
      finished_at: null,
    });
    expect(broadcastMock.broadcastToRoom).toHaveBeenCalledTimes(1);
  });

  it("keeps the expired-window refusal", async () => {
    const admin = makeAdmin({ occurredAt: "2026-07-19T03:59:55.000Z" });

    const res = await post(admin);

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(/undo window expired/);
    expectNothingChanged(admin);
  });

  it("changes nothing when the question cannot be read", async () => {
    const admin = makeAdmin({ questionError: { message: "read failed" } });

    const res = await post(admin);

    expect(res.status).toBe(500);
    expectNothingChanged(admin);
  });
});
