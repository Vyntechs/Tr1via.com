import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { scrambleFor } from "@/lib/game/scramble";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({
  getDeviceId: vi.fn(),
  requireOwnedPlayer: vi.fn(),
  requireOwnedPlayerReference: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const SENTINEL = "SENTINEL database host=private constraint=secret_key";
const QUESTION_ID = "11111111-1111-1111-1111-111111111111";
const CATEGORY_ID = "22222222-2222-2222-2222-222222222222";
const GAME_ID = "33333333-3333-3333-3333-333333333333";
const NIGHT_ID = "44444444-4444-4444-4444-444444444444";
const PLAYER_ID = "55555555-5555-5555-5555-555555555555";
const DEVICE_ID = "66666666-6666-6666-6666-666666666666";
const error = { code: "XX000", message: SENTINEL };

type Result = { data: unknown; error: typeof error | null };

function query(result: Result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
    single: vi.fn(async () => result),
    then: (
      onFulfilled: (value: Result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

async function expectGenericServerError(response: Response) {
  const body = await response.json();
  expect(response.status).toBe(500);
  expect(body).toEqual({ error: "server error" });
  expect(JSON.stringify(body)).not.toContain(SENTINEL);
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
  authMock.requireOwnedPlayer.mockResolvedValue({
    ok: true,
    player: {
      id: PLAYER_ID,
      night_id: NIGHT_ID,
      removed_at: null,
      app_switch_total_seconds: 0,
    },
  });
  authMock.requireOwnedPlayerReference.mockResolvedValue({
    ok: true,
    player: {
      id: PLAYER_ID,
      night_id: NIGHT_ID,
      removed_at: null,
      app_switch_total_seconds: 0,
    },
  });
});

describe("public and signed-player route error boundary", () => {
  it("does not expose a night lookup database error", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: vi.fn(() => query({ data: null, error })),
    });

    const { GET } = await import("@/app/api/nights/by-code/[code]/route");
    const response = await GET(new Request("http://test"), {
      params: Promise.resolve({ code: "ABCDEF" }),
    });

    await expectGenericServerError(response);
  });

  it("does not expose an answer insert database error", async () => {
    const expectedScramble = scrambleFor(QUESTION_ID, PLAYER_ID);
    const rows: Record<string, Result> = {
      questions: {
        data: {
          id: QUESTION_ID,
          category_id: CATEGORY_ID,
          played_at: "2026-07-19T04:00:00.000Z",
          finished_at: null,
          correct_index: 0,
        },
        error: null,
      },
      categories: { data: { id: CATEGORY_ID, game_id: GAME_ID }, error: null },
      games: { data: { id: GAME_ID, night_id: NIGHT_ID }, error: null },
      players: { data: { id: PLAYER_ID, removed_at: null }, error: null },
      game_participations: { data: { id: "participation-1" }, error: null },
    };
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "answers") {
          return { insert: vi.fn(async () => ({ data: null, error })) };
        }
        return query(rows[table]!);
      }),
    });

    const { POST } = await import("@/app/api/answers/route");
    const response = await POST(
      new NextRequest("http://test/api/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          questionId: QUESTION_ID,
          slotChosen: 1,
          scramble: expectedScramble,
        }),
      }),
    );

    await expectGenericServerError(response);
  });

  it("does not expose a Game 2 participation insert database error", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "games") {
          return query({ data: { id: GAME_ID, state: "ready" }, error: null });
        }
        if (table === "game_participations") {
          return { insert: vi.fn(async () => ({ data: null, error })) };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    });

    const { POST } = await import("@/app/api/players/[id]/join-game/route");
    const response = await POST(
      new NextRequest(`http://test/api/players/${PLAYER_ID}/join-game`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameNo: 2 }),
      }),
      { params: Promise.resolve({ id: PLAYER_ID }) },
    );

    await expectGenericServerError(response);
  });

  it("does not expose a heartbeat update database error", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue({
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: null, error })),
        })),
      })),
    });

    const { POST } = await import("@/app/api/players/[id]/heartbeat/route");
    const response = await POST(
      new NextRequest(`http://test/api/players/${PLAYER_ID}/heartbeat`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: PLAYER_ID }) },
    );

    await expectGenericServerError(response);
  });
});
