// Diagnostic logging for host controls and timer-end resolves.
//
// Proves each wrapped route is recorded under the right action name, actor
// and ids; that the step timings (sign-in, database, broadcast) are captured;
// that with the switch off the wrapper is the original handler; and that a row
// is stored ONLY for a verified caller: a signed-in host who owns the night, or
// (timer-end calls) a player of the night. Anyone else stores nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signDeviceCookie } from "@/lib/auth/device-cookie";
import { diagNote } from "@/lib/diagnostics/trace";

const authMock = vi.hoisted(() => ({
  requireOwnedGame: vi.fn(),
  requireOwnedNight: vi.fn(),
  getAuthedHost: vi.fn(),
}));
const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const writeMock = vi.hoisted(() => ({
  scheduleDiagWrite: vi.fn(),
  recordDiagRows: vi.fn(),
  noteIgnored: vi.fn(),
  lookupNightOwner: vi.fn(),
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
const HOST_ID = "66666666-6666-6666-6666-666666666666";
const OTHER_HOST_ID = "77777777-7777-7777-7777-777777777777";
const DEVICE_ID = "88888888-8888-8888-8888-888888888888";
const PLAYER_ID = "99999999-9999-4999-8999-999999999999";
const SECRET = "test-session-secret-0123456789";

/** Every query resolves to "nothing found", whatever is chained. */
function emptyAdmin() {
  const chain: unknown = new Proxy(() => chain, {
    get: (_target, prop) =>
      prop === "then" ? undefined : prop === "maybeSingle" ? async () => ({ data: null, error: null }) : () => chain,
  });
  return { from: () => chain, rpc: async () => ({ data: null, error: null }) };
}

function req(path: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return new NextRequest(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const deniedOwner = { ok: false, status: 401, error: "not signed in" };
/** What the real sign-in check does for a signed-in host: note who it was. The route then stops early. */
async function signedInHost() {
  diagNote({ hostId: HOST_ID });
  return deniedOwner;
}
const playerCookie = () => `tr1via_device=${signDeviceCookie(DEVICE_ID, SECRET)}`;

interface Case {
  name: string;
  load: () => Promise<{ POST: (...args: never[]) => Promise<Response> }>;
  params?: Record<string, string>;
  action: string;
  actor: "host" | "timer";
  ids: Record<string, string | undefined>;
  body?: unknown;
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
  { name: "score adjustment", load: () => import("@/app/api/adjustments/route"), action: "adjust", actor: "host", ids: { game_id: GAME_ID, night_id: NIGHT_ID }, body: { playerId: PLAYER_ID, gameId: GAME_ID, delta: 1 } },
];

describe("host control diagnostic log", () => {
  let pending: Array<() => Promise<void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    pending = [];
    vi.stubEnv("SESSION_SECRET", SECRET);
    authMock.requireOwnedGame.mockImplementation(signedInHost);
    authMock.requireOwnedNight.mockImplementation(signedInHost);
    authMock.getAuthedHost.mockImplementation(signedInHost);
    adminMock.getSupabaseAdmin.mockReturnValue(emptyAdmin());
    writeMock.scheduleDiagWrite.mockImplementation((task: () => Promise<void>) => {
      pending.push(task);
    });
    writeMock.lookupNightOwner.mockResolvedValue(HOST_ID);
    writeMock.lookupPlayerId.mockResolvedValue(PLAYER_ID);
    writeMock.lookupGameNight.mockResolvedValue(NIGHT_ID);
    writeMock.lookupRoomNight.mockResolvedValue(NIGHT_ID);
    writeMock.lookupQuestionContext.mockResolvedValue({ gameId: GAME_ID, nightId: NIGHT_ID });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function call(c: Case, headers: Record<string, string> = c.actor === "timer" ? { cookie: playerCookie() } : {}) {
    const { POST } = await c.load();
    const ctx = { params: Promise.resolve(c.params ?? {}) };
    const response = await (POST as unknown as (r: Request, x: typeof ctx) => Promise<Response>)(
      req("/api/test", c.body ?? {}, headers),
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

    it("records the press under its action name, actor and ids, for a verified caller", async () => {
      vi.stubEnv("DIAGNOSTIC_LOGGING", "on");
      const response = await call(c);
      expect(writeMock.recordDiagRows).toHaveBeenCalledTimes(1);
      const [table, rows, night, source] = writeMock.recordDiagRows.mock.calls[0] as [
        string,
        Record<string, unknown>[],
        string,
        unknown,
      ];
      expect(table).toBe("diag_server_actions");
      expect(night).toBe(NIGHT_ID);
      // a host press is the host's; a timer-end call is the player's who sent it
      expect(source).toEqual(c.actor === "host" ? { kind: "press" } : { kind: "tap", deviceId: DEVICE_ID });
      expect(writeMock.noteIgnored).not.toHaveBeenCalled();
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

  describe("a caller who is not verified stores NOTHING", () => {
    const reveal = CASES[0]!;
    const resolve = CASES.find((c) => c.name.startsWith("resolve"))!;
    const finalize = CASES.find((c) => c.name.startsWith("finalize"))!;

    beforeEach(() => vi.stubEnv("DIAGNOSTIC_LOGGING", "on"));

    function nothingStored() {
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      expect(writeMock.noteIgnored).toHaveBeenCalledWith("action");
    }

    it("a host press from someone who is not signed in: the answer is the same, and no job is even queued", async () => {
      authMock.requireOwnedGame.mockResolvedValue(deniedOwner); // no host noted
      const response = await call(reveal);
      expect(response.status).toBe(401);
      expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
      expect(writeMock.lookupGameNight).not.toHaveBeenCalled();
      expect(writeMock.lookupNightOwner).not.toHaveBeenCalled();
      nothingStored();
    });

    it("a signed-in host pressing a night that belongs to someone else", async () => {
      writeMock.lookupNightOwner.mockResolvedValue(OTHER_HOST_ID);
      await call(reveal);
      expect(writeMock.lookupNightOwner).toHaveBeenCalledWith(NIGHT_ID);
      nothingStored();
    });

    it("a host press about a game that does not exist", async () => {
      writeMock.lookupGameNight.mockResolvedValue(null);
      await call(reveal);
      nothingStored();
    });

    it("a timer-end call with no cookie (the venue TV sends these)", async () => {
      await call(resolve, {});
      expect(writeMock.scheduleDiagWrite).not.toHaveBeenCalled();
      expect(writeMock.lookupPlayerId).not.toHaveBeenCalled();
      nothingStored();
    });

    it("a timer-end call with a forged or wrongly signed cookie", async () => {
      await call(resolve, { cookie: `tr1via_device=${DEVICE_ID}.not-the-real-signature` });
      await call(resolve, { cookie: `tr1via_device=${signDeviceCookie(DEVICE_ID, "some-other-secret")}` });
      await call(resolve, { cookie: `other=1; tr1via_device=garbage` });
      expect(writeMock.lookupPlayerId).not.toHaveBeenCalled();
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
    });

    it("a timer-end call with a real cookie that is not a player of that night", async () => {
      writeMock.lookupPlayerId.mockResolvedValue(null);
      await call(finalize);
      expect(writeMock.lookupPlayerId).toHaveBeenCalledWith(NIGHT_ID, DEVICE_ID);
      nothingStored();
    });

    it("a host cookie does not count for a timer-end call, and a device cookie does not count for a host press", async () => {
      // a host press carries no device identity at all
      authMock.requireOwnedGame.mockResolvedValue(deniedOwner);
      await call(reveal, { cookie: playerCookie() });
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
      // and a timer-end call is judged only by its device cookie, never by a signed-in host
      await call(resolve, {});
      expect(writeMock.recordDiagRows).not.toHaveBeenCalled();
    });

    it("a made-up room code in the finalize address never reaches the database", async () => {
      await call({ ...finalize, params: { code: "not a room!", playId: PLAY_ID } });
      expect(writeMock.lookupRoomNight).not.toHaveBeenCalled();
      nothingStored();
    });

    it("a thrown error from a route is still re-thrown unchanged and is stored for a verified host", async () => {
      const boom = new Error("database exploded");
      adminMock.getSupabaseAdmin.mockImplementation(() => {
        throw boom;
      });
      authMock.requireOwnedGame.mockImplementation(async () => {
        diagNote({ hostId: HOST_ID });
        throw boom;
      });
      const { POST } = await reveal.load();
      await expect(
        (POST as unknown as (r: Request, x: unknown) => Promise<Response>)(req("/api/test"), {
          params: Promise.resolve({ id: GAME_ID }),
        }),
      ).rejects.toBe(boom);
      for (const task of pending) await task();
      const row = (writeMock.recordDiagRows.mock.calls[0]![1] as Record<string, unknown>[])[0]!;
      expect(row).toMatchObject({ outcome: "error", reason: "exception", action: "reveal" });
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
      diagNote({ hostId: HOST_ID });
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

    const row = (writeMock.recordDiagRows.mock.calls[0]![1] as Record<string, number | boolean | null>[])[0]!;
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
    authMock.requireOwnedGame.mockImplementation(async () => {
      diagNote({ hostId: HOST_ID });
      return { ok: true, night: { id: NIGHT_ID, room_code: "K9PR4M" } };
    });
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

    const row = (writeMock.recordDiagRows.mock.calls[0]![1] as Record<string, unknown>[])[0]!;
    expect(row).toMatchObject({ broadcast_ok: false, broadcast_error: "timeout", http_status: 200 });
  });
});
