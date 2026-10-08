// Diagnostic logging for host controls and timer-end resolves.
//
// Proves each wrapped route is recorded under the right action name, actor
// and ids; that the step timings (sign-in, database, broadcast) are captured;
// and that with the switch off the wrapper is the original handler.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({
  requireOwnedGame: vi.fn(),
  requireOwnedNight: vi.fn(),
  getAuthedHost: vi.fn(),
}));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const writeMock = vi.hoisted(() => ({
  scheduleDiagWrite: vi.fn(),
  insertDiagRows: vi.fn(),
  lookupQuestionContext: vi.fn(),
  lookupPlayerId: vi.fn(),
  lookupGameNight: vi.fn(),
  lookupRoomNight: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/diagnostics/write", () => writeMock);

const GAME_ID = "11111111-1111-1111-1111-111111111111";
const QUESTION_ID = "22222222-2222-2222-2222-222222222222";
const NIGHT_ID = "33333333-3333-3333-3333-333333333333";
const PLAY_ID = "44444444-4444-4444-4444-444444444444";
const CATEGORY_ID = "55555555-5555-5555-5555-555555555555";

/** Every query resolves to "nothing found", whatever is chained. */
function emptyAdmin() {
  const chain: unknown = new Proxy(() => chain, {
    get: (_target, prop) =>
      prop === "then" ? undefined : prop === "maybeSingle" ? async () => ({ data: null, error: null }) : () => chain,
  });
  return { from: () => chain, rpc: async () => ({ data: null, error: null }) };
}

function req(path: string, body: unknown = {}) {
  return new NextRequest(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const deniedOwner = { ok: false, status: 401, error: "not signed in" };

interface Case {
  name: string;
  load: () => Promise<{ POST: (...args: never[]) => Promise<Response> }>;
  params?: Record<string, string>;
  action: string;
  actor: "host" | "timer";
  ids: Record<string, string | undefined>;
}

const CASES: Case[] = [
  { name: "reveal", load: () => import("@/app/api/games/[id]/reveal/route"), params: { id: GAME_ID }, action: "reveal", actor: "host", ids: { game_id: GAME_ID, night_id: NIGHT_ID } },
  { name: "advance (the host's Next)", load: () => import("@/app/api/games/[id]/advance/route"), params: { id: GAME_ID }, action: "advance", actor: "host", ids: { game_id: GAME_ID, night_id: NIGHT_ID } },
  { name: "end early", load: () => import("@/app/api/games/[id]/end-early/route"), params: { id: GAME_ID }, action: "end_early", actor: "host", ids: { game_id: GAME_ID, night_id: NIGHT_ID } },
  { name: "end game", load: () => import("@/app/api/games/[id]/end/route"), params: { id: GAME_ID }, action: "end_game", actor: "host", ids: { game_id: GAME_ID, night_id: NIGHT_ID } },
  { name: "start game", load: () => import("@/app/api/games/[id]/start/route"), params: { id: GAME_ID }, action: "start_game", actor: "host", ids: { game_id: GAME_ID, night_id: NIGHT_ID } },
  { name: "undo", load: () => import("@/app/api/games/[id]/undo/route"), params: { id: GAME_ID }, action: "undo", actor: "host", ids: { game_id: GAME_ID, night_id: NIGHT_ID } },
  { name: "resolve (timer end)", load: () => import("@/app/api/questions/[id]/resolve/route"), params: { id: QUESTION_ID }, action: "resolve", actor: "timer", ids: { question_id: QUESTION_ID, night_id: NIGHT_ID } },
  { name: "close night", load: () => import("@/app/api/nights/[id]/close/route"), params: { id: NIGHT_ID }, action: "close_night", actor: "host", ids: { night_id: NIGHT_ID } },
  { name: "open night", load: () => import("@/app/api/nights/[id]/open/route"), params: { id: NIGHT_ID }, action: "open_night", actor: "host", ids: { night_id: NIGHT_ID } },
  { name: "finalize (timer end, live engine)", load: () => import("@/app/api/room/[code]/plays/[playId]/finalize/route"), params: { code: "K9PR4M", playId: PLAY_ID }, action: "finalize", actor: "timer", ids: { night_id: NIGHT_ID, play_id: PLAY_ID } },
  { name: "score adjustment", load: () => import("@/app/api/adjustments/route"), action: "adjust", actor: "host", ids: {} },
];

describe("host control diagnostic log", () => {
  let pending: Array<() => Promise<void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    pending = [];
    authMock.requireOwnedGame.mockResolvedValue(deniedOwner);
    authMock.requireOwnedNight.mockResolvedValue(deniedOwner);
    authMock.getAuthedHost.mockResolvedValue(deniedOwner);
    adminMock.getSupabaseAdmin.mockReturnValue(emptyAdmin());
    writeMock.scheduleDiagWrite.mockImplementation((task: () => Promise<void>) => {
      pending.push(task);
    });
    writeMock.lookupGameNight.mockResolvedValue(NIGHT_ID);
    writeMock.lookupRoomNight.mockResolvedValue(NIGHT_ID);
    writeMock.lookupQuestionContext.mockResolvedValue({ gameId: GAME_ID, nightId: NIGHT_ID });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function call(c: Case) {
    const { POST } = await c.load();
    const ctx = { params: Promise.resolve(c.params ?? {}) };
    const response = await (POST as unknown as (r: Request, x: typeof ctx) => Promise<Response>)(
      req("/api/test"),
      ctx,
    );
    for (const task of pending) await task();
    return response;
  }

  describe.each(CASES)("$name", (c) => {
    it("answers the same with logging off and schedules nothing", async () => {
      vi.stubEnv("DIAGNOSTIC_LOGGING", "off");
      const off = await call(c);
      expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();

      vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
      pending = [];
      const on = await call(c);
      expect(on.status).toBe(off.status);
    });

    it("records the press under its action name, actor and ids", async () => {
      vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
      const response = await call(c);
      expect(writeMock.insertDiagRows).toHaveBeenCalledTimes(1);
      const [table, rows] = writeMock.insertDiagRows.mock.calls[0] as [string, Record<string, unknown>[]];
      expect(table).toBe("diag_server_actions");
      expect(rows[0]).toMatchObject({
        action: c.action,
        actor: c.actor,
        http_status: response.status,
        ...c.ids,
      });
      expect(typeof rows[0]!.received_at).toBe("string");
      expect(rows[0]!.total_ms).toEqual(expect.any(Number));
      expect(rows[0]).toHaveProperty("cold_start");
    });
  });

  it("times the sign-in check, the database and the broadcast on a real press (Next)", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const { diagMark } = await import("@/lib/diagnostics/trace");
    authMock.requireOwnedGame.mockImplementation(async () => {
      diagMark("auth_done");
      diagMark("auth_done_last", true);
      return { ok: true, night: { id: NIGHT_ID, room_code: "K9PR4M" } };
    });
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const questionRow = { id: QUESTION_ID, category_id: CATEGORY_ID, finished_at: "2026-10-07T19:00:00.000Z" };
    adminMock.getSupabaseAdmin.mockReturnValue({
      rpc,
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "questions" ? questionRow : { game_id: GAME_ID },
              error: null,
            }),
          }),
        }),
      }),
    });
    const fetchStub = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchStub);

    const { POST } = await import("@/app/api/games/[id]/advance/route");
    const response = await POST(
      req(`/api/games/${GAME_ID}/advance`, { questionId: QUESTION_ID }),
      { params: Promise.resolve({ id: GAME_ID }) },
    );
    expect(response.status).toBe(200);
    for (const task of pending) await task();

    const row = (writeMock.insertDiagRows.mock.calls[0]![1] as Record<string, number | boolean | null>[])[0]!;
    expect(row).toMatchObject({ outcome: "ok", broadcast_ok: true, broadcast_error: null });
    const steps = row.steps as unknown as Record<string, number>;
    expect(steps).toEqual(
      expect.objectContaining({
        auth_done: expect.any(Number),
        broadcast_start: expect.any(Number),
        broadcast_done: expect.any(Number),
        sent_advance: expect.any(Number),
        total: expect.any(Number),
      }),
    );
    // Everything before the broadcast counts as sign-in + database time.
    expect(row.db_done_ms).toBe(row.broadcast_start_ms);
    expect(row.broadcast_start_ms as number).toBeLessThanOrEqual(row.broadcast_done_ms as number);
    expect(row.broadcast_done_ms as number).toBeLessThanOrEqual(row.total_ms as number);
    expect(row.auth_ms as number).toBeLessThanOrEqual(row.broadcast_start_ms as number);
  });

  it("notes a failed broadcast without changing the host's answer", async () => {
    vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    authMock.requireOwnedGame.mockResolvedValue({ ok: true, night: { id: NIGHT_ID, room_code: "K9PR4M" } });
    const questionRow = { id: QUESTION_ID, category_id: CATEGORY_ID, finished_at: "2026-10-07T19:00:00.000Z" };
    adminMock.getSupabaseAdmin.mockReturnValue({
      rpc: async () => ({ data: true, error: null }),
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: table === "questions" ? questionRow : { game_id: GAME_ID },
              error: null,
            }),
          }),
        }),
      }),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { POST } = await import("@/app/api/games/[id]/advance/route");
    const response = await POST(
      req(`/api/games/${GAME_ID}/advance`, { questionId: QUESTION_ID }),
      { params: Promise.resolve({ id: GAME_ID }) },
    );
    expect(response.status).toBe(200);
    for (const task of pending) await task();
    warn.mockRestore();

    const row = (writeMock.insertDiagRows.mock.calls[0]![1] as Record<string, unknown>[])[0]!;
    expect(row).toMatchObject({ broadcast_ok: false, broadcast_error: "timeout", http_status: 200 });
  });
});
