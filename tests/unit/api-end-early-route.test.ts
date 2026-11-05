import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { isAlreadyResolved } from "@/lib/host/endEarlyOutcome";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
const authMock = vi.hoisted(() => ({
  requireOwnedGame: vi.fn(),
}));
const broadcastMock = vi.hoisted(() => ({
  broadcastToRoom: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const QUESTION_ID = "22222222-2222-2222-2222-222222222222";
const CATEGORY_ID = "33333333-3333-3333-3333-333333333333";
const NIGHT_ID = "44444444-4444-4444-4444-444444444444";
const OTHER_NIGHT_ID = "55555555-5555-5555-5555-555555555555";
const NOW = "2026-07-19T04:00:00.000Z";
const PLAYED_AT = "2026-07-19T03:59:50.000Z";

type Row = Record<string, unknown>;

function makeRequest(body: unknown) {
  return new NextRequest(`http://test/api/games/${GAME_ID}/end-early`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx(gameId = GAME_ID) {
  return { params: Promise.resolve({ id: gameId }) };
}

function player(id: string, overrides: Row = {}): Row {
  return { id, night_id: NIGHT_ID, removed_at: null, can_answer: true, ...overrides };
}

/** A list read that really applies the .eq() and .is() filters the route sends. */
function listRead(rows: Row[], error: { message: string } | null = null) {
  const filters: Array<[string, unknown]> = [];
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    }),
    is: vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return builder;
    }),
    then: (
      onFulfilled: (value: { data: Row[] | null; error: unknown }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve({
        data: error
          ? null
          : rows.filter((row) =>
              filters.every(([column, value]) => row[column] === value),
            ),
        error,
      }).then(onFulfilled, onRejected),
  };
  return builder;
}

function singleRead(data: Row) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data, error: null })),
      })),
    })),
  };
}

function makeAdmin({
  resolved = true,
  rpcError = null,
  participants = ["p1", "p2"],
  players = [player("p1"), player("p2")],
  answered = ["p1", "p2"],
  playersError = null,
}: {
  resolved?: boolean;
  rpcError?: { message: string } | null;
  participants?: string[];
  players?: Row[];
  answered?: string[];
  playersError?: { message: string } | null;
} = {}) {
  const rpc = vi.fn(async () => ({
    data: rpcError ? null : resolved,
    error: rpcError,
  }));
  return {
    rpc,
    from: vi.fn((table: string) => {
      if (table === "questions") {
        return singleRead({
          id: QUESTION_ID,
          category_id: CATEGORY_ID,
          played_at: PLAYED_AT,
          finished_at: null,
          correct_index: 1,
        });
      }
      if (table === "categories") return singleRead({ game_id: GAME_ID });
      if (table === "game_participations") {
        return listRead(
          participants.map((player_id) => ({ game_id: GAME_ID, player_id })),
        );
      }
      if (table === "players") return listRead(players, playersError);
      if (table === "answers") {
        return listRead(
          answered.map((player_id) => ({ question_id: QUESTION_ID, player_id })),
        );
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

function closeLines(info: { mock: { calls: unknown[][] } }) {
  return info.mock.calls
    .filter(([line]) => typeof line === "string" && line.includes('"kind":"close"'))
    .map(([line]) => JSON.parse(line as string) as unknown);
}

async function post(admin: ReturnType<typeof makeAdmin>, body: unknown) {
  adminMock.getSupabaseAdmin.mockReturnValue(admin);
  const { POST } = await import("@/app/api/games/[id]/end-early/route");
  return POST(makeRequest(body), makeCtx());
}

const guarded = { questionId: QUESTION_ID, requireAllLocked: true };
const manual = { questionId: QUESTION_ID };

describe("POST /api/games/[id]/end-early", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    authMock.requireOwnedGame.mockResolvedValue({
      ok: true,
      night: { id: NIGHT_ID, room_code: "ABCDEF" },
    });
    broadcastMock.broadcastToRoom.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns 409 without resolving when a participant has not answered", async () => {
    const admin = makeAdmin({ answered: ["p1"] });

    const res = await post(admin, guarded);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "not all eligible players are locked",
    });
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
  });

  it("closes guarded auto-reveal once, with no table-locking function", async () => {
    const admin = makeAdmin();

    const res = await post(admin, guarded);

    expect(res.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question_once", {
      p_question_id: QUESTION_ID,
    });
    expect(broadcastMock.broadcastToRoom).toHaveBeenCalledTimes(1);
  });

  it("does not wait for removed, non-answering or other-night players", async () => {
    const admin = makeAdmin({
      participants: ["p1", "gone", "viewer", "elsewhere"],
      players: [
        player("p1"),
        player("gone", { removed_at: "2026-07-19T03:00:00.000Z" }),
        player("viewer", { can_answer: false }),
        player("elsewhere", { night_id: OTHER_NIGHT_ID }),
      ],
      answered: ["p1"],
    });

    const res = await post(admin, guarded);

    expect(res.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not let an answer from a removed player stand in for a missing one", async () => {
    const admin = makeAdmin({
      participants: ["p1", "p2", "gone"],
      players: [
        player("p1"),
        player("p2"),
        player("gone", { removed_at: "2026-07-19T03:00:00.000Z" }),
      ],
      answered: ["p1", "gone"],
    });

    const res = await post(admin, guarded);

    expect(res.status).toBe(409);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("ignores a saved answer from someone outside the eligible set", async () => {
    const admin = makeAdmin({
      participants: ["p1", "gone"],
      players: [
        player("p1"),
        player("gone", { removed_at: "2026-07-19T03:00:00.000Z" }),
      ],
      answered: ["p1", "gone"],
    });

    const res = await post(admin, guarded);

    expect(res.status).toBe(200);
  });

  it("refuses when nobody is eligible", async () => {
    const admin = makeAdmin({ participants: [], answered: [] });

    const res = await post(admin, guarded);

    expect(res.status).toBe(409);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("does not close when the locked check cannot be read", async () => {
    const admin = makeAdmin({ playersError: { message: "read failed" } });

    const res = await post(admin, guarded);

    expect(res.status).toBe(500);
    expect(admin.rpc).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
  });

  it("closes a manual press through resolve_question_once without the locked check", async () => {
    const admin = makeAdmin({ answered: [] });

    const res = await post(admin, manual);

    expect(res.status).toBe(200);
    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith("resolve_question_once", {
      p_question_id: QUESTION_ID,
    });
    expect(admin.from).not.toHaveBeenCalledWith("game_participations");
    expect(broadcastMock.broadcastToRoom).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a manual press", manual],
    ["guarded auto-reveal", guarded],
  ])("%s that loses the race does not broadcast or log a close", async (_name, body) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const admin = makeAdmin({ resolved: false });

    const res = await post(admin, body);

    expect(res.status).toBe(409);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe("question is already resolved");
    expect(isAlreadyResolved(payload.error)).toBe(true);
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
    expect(closeLines(info)).toEqual([]);
  });

  it("does not broadcast when the close fails", async () => {
    const admin = makeAdmin({ rpcError: { message: "boom" } });

    const res = await post(admin, manual);

    expect(res.status).toBe(500);
    expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
  });

  it.each([
    ["host", manual],
    ["host-auto", guarded],
  ])("logs a %s close after its broadcast, 15s before the deadline", async (closedBy, body) => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await post(makeAdmin(), body);

    expect(closeLines(info)).toEqual([{
      kind: "close",
      questionId: QUESTION_ID,
      roomCode: "ABCDEF",
      closedBy,
      lateMs: -15_000,
    }]);
    expect(broadcastMock.broadcastToRoom.mock.invocationCallOrder[0])
      .toBeLessThan(info.mock.invocationCallOrder[0]);
  });
});
