import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ requireOwnedNight: vi.fn() }));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/supabase/admin", () => adminMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const GAME_ID = "22222222-2222-2222-2222-222222222222";

function request() {
  return new NextRequest(`http://test/api/nights/${NIGHT_ID}/preflight`);
}

function context() {
  return { params: Promise.resolve({ id: NIGHT_ID }) };
}

type Fixture = {
  game?: Record<string, unknown> | null;
  gameError?: { message: string } | null;
  categories?: Array<Record<string, unknown>>;
  categoryError?: { message: string } | null;
  questions?: Array<Record<string, unknown>>;
  questionError?: { message: string } | null;
  reports?: Array<Record<string, unknown>>;
  reportError?: { message: string } | null;
  playerCount?: number;
  playerError?: { message: string } | null;
};

function category(id: string, state = "ready") {
  return { id, state };
}

function question(categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `q-${categoryId}`,
    category_id: categoryId,
    prompt: "A complete question?",
    options: ["A", "B", "C", "D"],
    correct_index: 0,
    point_value: 100,
    source: "ai",
    is_picked: true,
    ...overrides,
  };
}

function report(categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    category_id: categoryId,
    status: "completed",
    accepted_count: 20,
    created_at: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

function queryResult<T>(value: T, error: { message: string } | null = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: value, error }),
    then: (resolve: (result: { data: T; error: typeof error; count?: number }) => unknown) =>
      Promise.resolve(resolve({ data: value, error })),
    insert: vi.fn(() => { throw new Error("preflight must not insert"); }),
    update: vi.fn(() => { throw new Error("preflight must not update"); }),
    delete: vi.fn(() => { throw new Error("preflight must not delete"); }),
  };
}

function adminWith(fixture: Fixture = {}) {
  const game = queryResult(
    fixture.game === undefined
      ? { id: GAME_ID, state: "ready", category_count: 1, question_count: 1 }
      : fixture.game,
    fixture.gameError,
  );
  const categories = queryResult(
    fixture.categories ?? [category("cat-1")],
    fixture.categoryError,
  );
  const questions = queryResult(
    fixture.questions ?? [question("cat-1")],
    fixture.questionError,
  );
  const reports = queryResult(
    fixture.reports ?? [report("cat-1")],
    fixture.reportError,
  );
  const players = queryResult([], fixture.playerError);
  players.then = (resolve) => Promise.resolve(resolve({
    data: [],
    error: fixture.playerError ?? null,
    count: fixture.playerCount ?? 0,
  })) as never;

  const byTable = { games: game, categories, questions, question_generation_reports: reports, players };
  return {
    from: vi.fn((table: keyof typeof byTable) => byTable[table]),
    queries: Object.values(byTable),
  };
}

describe("GET /api/nights/[id]/preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: "host-1" },
      night: { id: NIGHT_ID, room_code: "ABC123" },
    });
  });

  it.each([
    [401, "not signed in"],
    [403, "not your night"],
    [404, "night not found"],
  ] as const)("preserves %s ownership failures without querying readiness", async (status, error) => {
    authMock.requireOwnedNight.mockResolvedValue({ ok: false, status, error });
    const { GET } = await import("@/app/api/nights/[id]/preflight/route");

    const response = await GET(request(), context());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
    expect(adminMock.getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("reports only evidence the read-only control round-trip can prove", async () => {
    const admin = adminWith({ playerCount: 0 });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { GET } = await import("@/app/api/nights/[id]/preflight/route");

    const response = await GET(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      checks: {
        content: "ready",
        tv: "unknown",
        players: "unknown",
        network: "control-path-healthy",
        controls: "ready",
      },
      playerCount: 0,
      canStart: true,
      content: {
        gameId: GAME_ID,
        categoryCount: 1,
        expectedCategoryCount: 1,
        pickedQuestionCount: 1,
        expectedQuestionCount: 1,
        reason: null,
      },
    });
    expect(body.checkedAt).toEqual(expect.any(String));
    expect(Number.isFinite(Date.parse(body.checkedAt))).toBe(true);
    expect(body.elapsedMs).toEqual(expect.any(Number));
    expect(body.elapsedMs).toBeGreaterThanOrEqual(0);
    for (const query of admin.queries) {
      expect(query.insert).not.toHaveBeenCalled();
      expect(query.update).not.toHaveBeenCalled();
      expect(query.delete).not.toHaveBeenCalled();
    }
  });

  it("counts active players without treating zero players as a failure", async () => {
    const admin = adminWith({ playerCount: 4 });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { GET } = await import("@/app/api/nights/[id]/preflight/route");

    const body = await (await GET(request(), context())).json();

    expect(body.playerCount).toBe(4);
    expect(body.checks.players).toBe("unknown");
    expect(body.canStart).toBe(true);
  });

  it("accepts complete manual questions without an AI generation report", async () => {
    const admin = adminWith({
      questions: [question("cat-1", { source: "host-edit" })],
      reports: [],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { GET } = await import("@/app/api/nights/[id]/preflight/route");

    const body = await (await GET(request(), context())).json();

    expect(body.checks.content).toBe("ready");
    expect(body.canStart).toBe(true);
  });

  it.each([
    {
      name: "missing Game 1",
      fixture: { game: null },
      reason: "Game 1 is missing.",
    },
    {
      name: "an incomplete board",
      fixture: { questions: [] },
      reason: "Game 1 needs 1 picked question before it can start.",
    },
    {
      name: "invalid picked content",
      fixture: { questions: [question("cat-1", { options: ["A", "B"], correct_index: 3 })] },
      reason: "A picked question is incomplete.",
    },
    {
      name: "uncertified AI content",
      fixture: { reports: [report("cat-1", { status: "partial" })] },
      reason: "AI questions are not certified yet.",
    },
  ])("blocks start for $name", async ({ fixture, reason }) => {
    const admin = adminWith(fixture);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { GET } = await import("@/app/api/nights/[id]/preflight/route");

    const body = await (await GET(request(), context())).json();

    expect(body.checks.content).toBe("invalid");
    expect(body.content.reason).toBe(reason);
    expect(body.canStart).toBe(false);
  });

  it("blocks an explicitly unavailable TV surface but not an unobserved one", async () => {
    const admin = adminWith();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: "host-1" },
      night: { id: NIGHT_ID, room_code: "" },
    });
    const { GET } = await import("@/app/api/nights/[id]/preflight/route");

    const body = await (await GET(request(), context())).json();

    expect(body.checks.tv).toBe("missing");
    expect(body.canStart).toBe(false);
  });

  it("sanitizes database errors and never returns query details", async () => {
    const admin = adminWith({ questionError: { message: "private SQL and customer data" } });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { GET } = await import("@/app/api/nights/[id]/preflight/route");

    const response = await GET(request(), context());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "could not check game readiness" });
  });
});
