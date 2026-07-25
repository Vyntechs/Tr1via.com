import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedGame: vi.fn() }));
const broadcastMock = vi.hoisted(() => ({
  broadcastAppliedLiveRoomEvent: vi.fn(),
  broadcastToRoom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const GAME_ID = "22222222-2222-2222-2222-222222222222";
const CATEGORY_ID = "33333333-3333-3333-3333-333333333333";
const QUESTION_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_QUESTION_ID = "55555555-5555-5555-5555-555555555555";

function gameContext() {
  return { params: Promise.resolve({ id: GAME_ID }) };
}

function revealRequest() {
  return new NextRequest(`http://test/api/games/${GAME_ID}/reveal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ questionId: QUESTION_ID }),
  });
}

function concurrentLegacyAdmin() {
  let playedAt: string | null = null;
  let questionReads = 0;
  let releaseQuestionReads!: () => void;
  const bothQuestionReadsStarted = new Promise<void>((resolve) => {
    releaseQuestionReads = resolve;
  });
  const insertReveal = vi.fn(async () => ({ error: null }));

  function questionReadBuilder() {
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const snapshot = {
          id: QUESTION_ID,
          category_id: CATEGORY_ID,
          played_at: playedAt,
          finished_at: null,
          is_picked: true,
        };
        questionReads += 1;
        if (questionReads === 2) releaseQuestionReads();
        await bothQuestionReadsStarted;
        return { data: snapshot, error: null };
      }),
    };
    return builder;
  }

  function questionStampBuilder(values: { played_at: string }) {
    let result: Promise<{ data: { id: string } | null; error: null }> | null = null;
    const execute = () => {
      result ??= Promise.resolve().then(() => {
        if (playedAt !== null) return { data: null, error: null };
        playedAt = values.played_at;
        return { data: { id: QUESTION_ID }, error: null };
      });
      return result;
    };
    const builder = {
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(execute),
      then: (
        resolve: (value: { data: { id: string } | null; error: null }) => unknown,
        reject: (reason: unknown) => unknown,
      ) => execute().then(resolve, reject),
    };
    return builder;
  }

  const admin = {
    from: vi.fn((table: string) => {
      if (table === "questions") {
        return {
          ...questionReadBuilder(),
          update: vi.fn(questionStampBuilder),
        };
      }
      if (table === "categories") {
        const builder = {
          select: vi.fn(() => builder),
          eq: vi.fn(() => builder),
          maybeSingle: vi.fn(async () => ({
            data: { game_id: GAME_ID },
            error: null,
          })),
        };
        return builder;
      }
      if (table === "reveals") {
        return { insert: insertReveal };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  };

  return { admin, insertReveal };
}

describe("legacy reveal idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    broadcastMock.broadcastToRoom.mockResolvedValue(undefined);
  });

  it("lets only the conditional-stamp winner insert and broadcast during concurrent Show taps", async () => {
    const { admin, insertReveal } = concurrentLegacyAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/reveal/route");
    const responses = await Promise.all([
      POST(revealRequest(), gameContext()),
      POST(revealRequest(), gameContext()),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const losingResponse = responses.find((response) => response.status === 409);
    expect(losingResponse).toBeDefined();
    expect(await losingResponse?.json()).toEqual({
      error: "question already revealed",
    });
    expect(insertReveal).toHaveBeenCalledTimes(1);
    expect(broadcastMock.broadcastToRoom).toHaveBeenCalledTimes(1);
  });
});

// One-tap reveal removed the client-side staging that used to make a rapid
// second tap on a different board cell unreachable. The legacy reveal route
// must now enforce "at most one unfinished question per game" itself, matching
// the resilient engine's open_question_play guard.
function singleLiveGuardAdmin({ otherLive }: { otherLive: boolean }) {
  const stamp = vi.fn();
  const insertReveal = vi.fn(async () => ({ error: null }));
  const otherLiveRows = otherLive ? [{ id: OTHER_QUESTION_ID }] : [];

  function thenable<T>(value: T) {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "not", "is", "neq", "limit"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.then = (
      resolve: (value: { data: T; error: null }) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: value, error: null }).then(resolve, reject);
    return builder;
  }

  const admin = {
    from: vi.fn((table: string) => {
      if (table === "questions") {
        return {
          select: vi.fn((cols: string) => {
            if (cols === "id") {
              // the "any other unfinished question in this game" guard query
              return thenable(otherLiveRows);
            }
            const builder = {
              select: vi.fn(() => builder),
              eq: vi.fn(() => builder),
              maybeSingle: vi.fn(async () => ({
                data: {
                  id: QUESTION_ID,
                  category_id: CATEGORY_ID,
                  played_at: null,
                  finished_at: null,
                  is_picked: true,
                },
                error: null,
              })),
            };
            return builder;
          }),
          update: vi.fn(() => {
            stamp();
            const builder = {
              eq: vi.fn(() => builder),
              is: vi.fn(() => builder),
              select: vi.fn(() => builder),
              maybeSingle: vi.fn(async () => ({ data: { id: QUESTION_ID }, error: null })),
            };
            return builder;
          }),
        };
      }
      if (table === "categories") {
        return {
          select: vi.fn((cols: string) => {
            if (cols === "id") {
              // the game's category ids, used to scope the guard query
              return thenable([{ id: CATEGORY_ID }]);
            }
            const builder = {
              eq: vi.fn(() => builder),
              maybeSingle: vi.fn(async () => ({ data: { game_id: GAME_ID }, error: null })),
            };
            return builder;
          }),
        };
      }
      if (table === "reveals") return { insert: insertReveal };
      throw new Error(`unexpected table: ${table}`);
    }),
  };
  return { admin, stamp, insertReveal };
}

describe("legacy reveal single-live-question guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.requireOwnedGame.mockResolvedValue({
      ok: true,
      host: { id: "host" },
      night: { id: NIGHT_ID, room_code: "ABCDEF", answer_engine: "legacy" },
      gameId: GAME_ID,
    });
    broadcastMock.broadcastToRoom.mockResolvedValue(undefined);
  });

  it("rejects revealing a second question while another is still unfinished", async () => {
    const { admin, stamp, insertReveal } = singleLiveGuardAdmin({ otherLive: true });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/reveal/route");
    const response = await POST(revealRequest(), gameContext());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "another question is already live in this game",
    });
    expect(stamp).not.toHaveBeenCalled();
    expect(insertReveal).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
  });

  it("reveals normally when no other question in the game is unfinished", async () => {
    const { admin, stamp, insertReveal } = singleLiveGuardAdmin({ otherLive: false });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/games/[id]/reveal/route");
    const response = await POST(revealRequest(), gameContext());

    expect(response.status).toBe(200);
    expect(stamp).toHaveBeenCalledTimes(1);
    expect(insertReveal).toHaveBeenCalledTimes(1);
    expect(broadcastMock.broadcastToRoom).toHaveBeenCalledTimes(1);
  });
});
