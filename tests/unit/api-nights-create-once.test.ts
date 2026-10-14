import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ getAuthedHost: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const HOST = "772f91c9-c7fc-424b-9429-207e4527cad1";
const FIRST = "14a0091e-8570-46dd-9ce2-9a6ac7d22fd7";
const NEW = "0993af1d-8571-4929-94e4-62d3392d44fc";

type Result = { data: unknown; error: unknown };

function chain(result: Result) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "gte", "order", "limit", "in"]) b[m] = vi.fn(() => b);
  b.single = vi.fn(async () => result);
  b.then = (res: (v: Result) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return b;
}

interface Setup {
  rpc: Result;
  recent?: unknown[];
  games?: unknown[];
  categories?: unknown[];
  players?: unknown[];
}

function makeAdmin(s: Setup) {
  const nightsInsert = vi.fn(() => chain({ data: { id: NEW, room_code: "EYBRKT" }, error: null }));
  const gamesInsert = vi.fn(async () => ({ error: null }));
  const rpc = vi.fn(async () => s.rpc);
  const lookups: Record<string, Result> = {
    nights: { data: s.recent ?? [], error: null },
    games: { data: s.games ?? [], error: null },
    categories: { data: s.categories ?? [], error: null },
    players: { data: s.players ?? [], error: null },
  };
  const admin = {
    rpc,
    from: vi.fn((table: string) => {
      const lookup = chain(lookups[table] ?? { data: [], error: null });
      return {
        ...lookup,
        insert: table === "nights" ? nightsInsert : gamesInsert,
        delete: vi.fn(() => chain({ data: null, error: null })),
      };
    }),
  };
  return { admin, rpc, nightsInsert, gamesInsert };
}

const MISSING_FN = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
const freshEmpty = {
  id: FIRST,
  room_code: "ZN4WJW",
  venue_name: "Soul Fire Pizza",
  theme_key: null,
  scheduled_at: null,
  created_at: new Date().toISOString(),
};
const twoDraftGames = [
  { id: "g1", night_id: FIRST, state: "draft", started_at: null },
  { id: "g2", night_id: FIRST, state: "draft", started_at: null },
];

function post() {
  return new NextRequest("http://test/api/nights", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ venueName: "Soul Fire Pizza" }),
  });
}

async function call(setup: Setup) {
  const m = makeAdmin(setup);
  adminMock.getSupabaseAdmin.mockReturnValue(m.admin);
  const { POST } = await import("@/app/api/nights/route");
  const res = await POST(post());
  return { res, body: await res.json(), ...m };
}

describe("POST /api/nights — one night per tap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getAuthedHost.mockResolvedValue({ ok: true, host: { id: HOST } });
  });

  it("uses the locked database function when it exists (new night → 201)", async () => {
    const { res, body, rpc, nightsInsert } = await call({
      rpc: { data: [{ night_id: NEW, room_code: "EYBRKT", reused: false }], error: null },
    });
    expect(res.status).toBe(201);
    expect(body).toEqual({ nightId: NEW, roomCode: "EYBRKT", reused: false });
    const [name, args] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(name).toBe("create_night_once");
    expect(args.p_host_id).toBe(HOST);
    expect(args.p_reuse_window_seconds).toBe(600);
    expect((args.p_room_codes as string[]).length).toBe(6);
    expect(nightsInsert).not.toHaveBeenCalled();
  });

  it("a second tap gets the first night back from the database function (200, reused)", async () => {
    const { res, body } = await call({
      rpc: { data: [{ night_id: FIRST, room_code: "ZN4WJW", reused: true }], error: null },
    });
    expect(res.status).toBe(200);
    expect(body).toEqual({ nightId: FIRST, roomCode: "ZN4WJW", reused: true });
  });

  it("before the migration: Heather's second tap returns her first, still-empty night", async () => {
    const { res, body, nightsInsert, gamesInsert } = await call({
      rpc: MISSING_FN,
      recent: [freshEmpty],
      games: twoDraftGames,
    });
    expect(res.status).toBe(200);
    expect(body).toEqual({ nightId: FIRST, roomCode: "ZN4WJW", reused: true });
    expect(nightsInsert).not.toHaveBeenCalled();
    expect(gamesInsert).not.toHaveBeenCalled();
  });

  it("never reuses a night that already has a category", async () => {
    const { res, body, nightsInsert, gamesInsert } = await call({
      rpc: MISSING_FN,
      recent: [freshEmpty],
      games: twoDraftGames,
      categories: [{ game_id: "g1" }],
    });
    expect(res.status).toBe(201);
    expect(body.nightId).toBe(NEW);
    expect(nightsInsert).toHaveBeenCalledTimes(1);
    expect(gamesInsert).toHaveBeenCalledTimes(1);
  });

  it("never reuses a night that already has a player, a started game, or another venue", async () => {
    for (const setup of [
      { players: [{ night_id: FIRST }] },
      { games: [twoDraftGames[0], { ...twoDraftGames[1], state: "live", started_at: "2026-10-08T23:00:00Z" }] },
      { recent: [{ ...freshEmpty, venue_name: "Another Bar" }] },
    ]) {
      const { res } = await call({ rpc: MISSING_FN, recent: [freshEmpty], games: twoDraftGames, ...setup });
      expect(res.status).toBe(201);
    }
  });

  it("creates normally when there is no fresh empty night", async () => {
    const { res, body, nightsInsert } = await call({ rpc: MISSING_FN, recent: [] });
    expect(res.status).toBe(201);
    expect(body).toEqual({ nightId: NEW, roomCode: "EYBRKT", reused: false });
    expect(nightsInsert).toHaveBeenCalledTimes(1);
  });

  it("fails closed (500, no insert) when the database function errors for another reason", async () => {
    const { res, nightsInsert } = await call({
      rpc: { data: null, error: { code: "57014", message: "statement timeout" } },
    });
    expect(res.status).toBe(500);
    expect(nightsInsert).not.toHaveBeenCalled();
  });
});
