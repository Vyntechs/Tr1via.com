// The routes that carry the closer, the alarm and the repair. The logic has its
// own tests in closeDue and scoreLateAnswers. These check each route calls it at
// the right moment, and only there. after() is captured so a test can run what
// it was handed, which proves nothing about after() on Vercel.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({
  getDeviceId: vi.fn(),
  requireOwnedGame: vi.fn(),
  requireOwnedPlayerReference: vi.fn(),
}));
const broadcastMock = vi.hoisted(() => ({
  broadcastToRoom: vi.fn(),
  broadcastFireworks: vi.fn(),
  broadcastGameEnded: vi.fn(),
  broadcastAppliedLiveRoomEvent: vi.fn(),
}));
const afterMock = vi.hoisted(() => ({
  pending: [] as Array<() => Promise<unknown>>,
  afterReply: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);
vi.mock("@/lib/live/afterReply", () => ({ afterReply: afterMock.afterReply }));

import { POST as postAnswer } from "@/app/api/answers/route";
import { POST as postEnd } from "@/app/api/games/[id]/end/route";
import { POST as postEndEarly } from "@/app/api/games/[id]/end-early/route";
import { POST as postReveal, maxDuration } from "@/app/api/games/[id]/reveal/route";
import { POST as postHeartbeat } from "@/app/api/players/[id]/heartbeat/route";
import { POST as postResolve } from "@/app/api/questions/[id]/resolve/route";
import { scrambleFor } from "@/lib/game/scramble";
import { fakeLiveAdmin } from "./helpers/fakeLiveAdmin";

const NIGHT = "11111111-1111-4111-8111-111111111111";
const GAME = "22222222-2222-4222-8222-222222222222";
const CATEGORY = "33333333-3333-4333-8333-333333333333";
const QUESTION = "44444444-4444-4444-8444-444444444444";
const PREVIOUS = "55555555-5555-4555-8555-555555555555";
const PLAYER = "66666666-6666-4666-8666-666666666666";
const ROOM = "ABCDEF";
const NOW = Date.parse("2026-11-04T20:00:00.000Z");

const night = {
  id: NIGHT,
  room_code: ROOM,
  answer_engine: "legacy",
  theme_key: "house",
  hosts: { default_theme_key: "house" },
};

function logged(info: { mock: { calls: unknown[][] } }, kind: string) {
  return info.mock.calls
    .map(([line]) => {
      try {
        return JSON.parse(String(line)) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((event) => event?.kind === kind);
}

const resolveBroadcasts = () =>
  broadcastMock.broadcastToRoom.mock.calls.filter(([, event]) => event === "resolve");

function jsonPost(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("closer wiring in the routes", () => {
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
    vi.stubEnv("LIVE_CLOSE_MODE", "on");
    for (const mock of Object.values(broadcastMock)) {
      mock.mockReset().mockResolvedValue(undefined);
    }
    afterMock.pending.length = 0;
    afterMock.afterReply.mockReset().mockImplementation((work) => {
      afterMock.pending.push(work);
    });
    authMock.requireOwnedGame.mockReset().mockResolvedValue({
      ok: true,
      night,
      host: { default_theme_key: "house" },
      gameId: GAME,
    });
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("POST /api/games/:id/reveal", () => {
    const context = { params: Promise.resolve({ id: GAME }) };

    function seed() {
      return {
        questions: [
          { id: QUESTION, category_id: CATEGORY, played_at: null as string | null, finished_at: null as string | null, is_picked: true, correct_index: 1, point_value: 200 },
          { id: PREVIOUS, category_id: CATEGORY, played_at: "2026-11-04T19:59:00+00:00", finished_at: "2026-11-04T19:59:26+00:00", is_picked: true, correct_index: 1, point_value: 300 },
        ],
        categories: [{ id: CATEGORY, game_id: GAME }],
        reveals: [] as Record<string, unknown>[],
        answers: [
          {
            id: "late-row",
            question_id: PREVIOUS,
            chosen_index: 1,
            ms_to_lock: 24_950,
            locked_at: "2026-11-04T19:59:24.950+00:00",
            is_correct: null as boolean | null,
            awarded_points: null as number | null,
          },
        ],
      };
    }

    const reveal = () =>
      postReveal(jsonPost(`/api/games/${GAME}/reveal`, { questionId: QUESTION }), context);

    it("gives the function room for a 26s sleep", () => {
      expect(maxDuration).toBe(60);
    });

    it("sets an alarm that closes the question 26.2s after the stamp", async () => {
      const data = seed();
      const admin = fakeLiveAdmin(data);
      adminMock.getSupabaseAdmin.mockReturnValue(admin);

      const res = await reveal();
      expect(res.status).toBe(200);
      expect(admin.rpc).not.toHaveBeenCalled();

      const work = afterMock.pending.splice(0).map((run) => run());
      await vi.advanceTimersByTimeAsync(26_199);
      expect(admin.rpc).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.all(work);

      expect(admin.rpc).toHaveBeenCalledTimes(1);
      expect(admin.rpc).toHaveBeenCalledWith("resolve_question_once", { p_question_id: QUESTION });
      expect(resolveBroadcasts()).toHaveLength(1);
      expect(logged(info, "alarm_wake")[0]).toMatchObject({ outcome: "won", lateMs: 0 });
    });

    it("sets the alarm even if the reveals insert then fails", async () => {
      adminMock.getSupabaseAdmin.mockReturnValue(
        fakeLiveAdmin(seed(), {
          insertResult: { reveals: { data: null, error: { message: "insert failed" } } },
        }),
      );
      const res = await reveal();
      expect(res.status).toBe(500);
      expect(afterMock.afterReply).toHaveBeenCalledTimes(2);
    });

    it("sets no alarm when the stamp didn't happen", async () => {
      const data = seed();
      data.questions[0]!.played_at = "2026-11-04T19:59:50+00:00";
      adminMock.getSupabaseAdmin.mockReturnValue(fakeLiveAdmin(data));
      const res = await reveal();
      expect(res.status).toBe(409);
      expect(afterMock.afterReply).not.toHaveBeenCalled();
    });

    it("repairs the previous question in the same game", async () => {
      const data = seed();
      adminMock.getSupabaseAdmin.mockReturnValue(fakeLiveAdmin(data));
      await reveal();
      const work = afterMock.pending.splice(0).map((run) => run());
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.all(work);
      expect(data.answers[0]).toMatchObject({ is_correct: true, awarded_points: 300 });
    });

    it("schedules nothing when off", async () => {
      vi.stubEnv("LIVE_CLOSE_MODE", "off");
      adminMock.getSupabaseAdmin.mockReturnValue(fakeLiveAdmin(seed()));
      const res = await reveal();
      expect(res.status).toBe(200);
      expect(afterMock.afterReply).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/answers", () => {
    const scramble = () => Array.from(scrambleFor(QUESTION, PLAYER));
    /** The visible slot that holds canonical option `index` for this player. */
    const slotFor = (index: number) => scramble().indexOf(index as never) + 1;

    function seed(question: Record<string, unknown> = {}) {
      return {
        questions: [
          {
            id: QUESTION,
            category_id: CATEGORY,
            played_at: "2026-11-04T19:59:50.000+00:00",
            finished_at: null as string | null,
            correct_index: 1,
            point_value: 400,
            ...question,
          },
        ],
        categories: [{ id: CATEGORY, game_id: GAME }],
        games: [{ id: GAME, night_id: NIGHT }],
        nights: [night],
        players: [{ id: PLAYER, night_id: NIGHT, device_id: "device-1", removed_at: null }],
        game_participations: [{ id: "part-1", game_id: GAME, player_id: PLAYER }],
        answers: [] as Record<string, unknown>[],
      };
    }

    const storedRow = (overrides: Record<string, unknown> = {}) => ({
      id: "stored",
      question_id: QUESTION,
      player_id: PLAYER,
      chosen_index: 1,
      ms_to_lock: 9_000,
      locked_at: "2026-11-04T19:59:59.000+00:00",
      is_correct: null,
      awarded_points: null,
      ...overrides,
    });

    const answer = (slot: number) =>
      postAnswer(
        jsonPost("/api/answers", { questionId: QUESTION, slotChosen: slot, scramble: scramble() }),
      );

    beforeEach(() => {
      authMock.getDeviceId.mockReset().mockResolvedValue("device-1");
    });

    it("scores an answer that committed just behind the close", async () => {
      const data = seed();
      adminMock.getSupabaseAdmin.mockReturnValue(
        fakeLiveAdmin(data, {
          before: (table, op) => {
            if (table === "answers" && op === "insert") {
              data.answers.push(storedRow());
              data.questions[0]!.finished_at = "2026-11-04T20:00:00.010+00:00";
            }
          },
        }),
      );
      const res = await answer(slotFor(1));
      expect(res.status).toBe(204);
      expect(data.answers[0]).toMatchObject({ is_correct: null });

      await Promise.all(afterMock.pending.splice(0).map((run) => run()));
      expect(data.answers[0]).toMatchObject({ is_correct: true, awarded_points: 400 });
    });

    it("leaves a normal answer alone while the question is open", async () => {
      const data = seed();
      const admin = fakeLiveAdmin(data);
      adminMock.getSupabaseAdmin.mockReturnValue(admin);
      await answer(slotFor(1));
      await Promise.all(afterMock.pending.splice(0).map((run) => run()));
      expect(admin.writes.filter((write) => write.op === "update")).toEqual([]);
    });

    it("on a duplicate, scores the stored row and ignores the resend's choice", async () => {
      const data = seed({ finished_at: null });
      data.answers.push(storedRow({ chosen_index: 1 }));
      adminMock.getSupabaseAdmin.mockReturnValue(
        fakeLiveAdmin(data, {
          insertResult: { answers: { data: null, error: { code: "23505", message: "dup" } } },
          before: (table, op) => {
            if (table === "answers" && op === "insert") {
              data.questions[0]!.finished_at = "2026-11-04T20:00:00.010+00:00";
            }
          },
        }),
      );
      const res = await answer(slotFor(3));
      expect(res.status).toBe(409);
      await Promise.all(afterMock.pending.splice(0).map((run) => run()));
      expect(data.answers[0]).toMatchObject({ chosen_index: 1, is_correct: true, awarded_points: 400 });
    });

    it("on a late resend of a saved answer, repairs before the 409 goes back", async () => {
      vi.setSystemTime(Date.parse("2026-11-04T20:00:16.000Z"));
      const data = seed({ finished_at: "2026-11-04T20:00:15.400+00:00" });
      data.answers.push(storedRow());
      adminMock.getSupabaseAdmin.mockReturnValue(fakeLiveAdmin(data));

      const res = await answer(slotFor(1));
      expect(res.status).toBe(409);
      expect(data.answers[0]).toMatchObject({ is_correct: true, awarded_points: 400 });
    });

    it("a late answer with no saved row is refused and repairs nothing", async () => {
      vi.setSystemTime(Date.parse("2026-11-04T20:00:16.000Z"));
      const admin = fakeLiveAdmin(seed({ finished_at: "2026-11-04T20:00:15.400+00:00" }));
      adminMock.getSupabaseAdmin.mockReturnValue(admin);
      const res = await answer(slotFor(1));
      expect(res.status).toBe(400);
      expect(afterMock.afterReply).not.toHaveBeenCalled();
    });

    it("schedules nothing when off", async () => {
      vi.stubEnv("LIVE_CLOSE_MODE", "off");
      adminMock.getSupabaseAdmin.mockReturnValue(fakeLiveAdmin(seed()));
      const res = await answer(slotFor(1));
      expect(res.status).toBe(204);
      expect(afterMock.afterReply).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/games/:id/end", () => {
    it("repairs the game's last question", async () => {
      const data = {
        games: [{ id: GAME, state: "live", ended_at: null }],
        categories: [{ id: CATEGORY, game_id: GAME }],
        questions: [
          { id: QUESTION, category_id: CATEGORY, correct_index: 0, point_value: 700, finished_at: "2026-11-04T19:59:58+00:00" },
        ],
        answers: [
          { id: "last-row", question_id: QUESTION, chosen_index: 0, ms_to_lock: 3_000, locked_at: "2026-11-04T19:59:57+00:00", is_correct: null },
        ],
      };
      adminMock.getSupabaseAdmin.mockReturnValue(fakeLiveAdmin(data));
      const res = await postEnd(jsonPost(`/api/games/${GAME}/end`, {}), {
        params: Promise.resolve({ id: GAME }),
      });
      expect(res.status).toBe(200);
      const work = afterMock.pending.splice(0).map((run) => run());
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.all(work);
      expect(data.answers[0]).toMatchObject({ is_correct: true, awarded_points: 770 });
    });
  });

  describe("close records from the browser and host closes", () => {
    function seed() {
      return {
        questions: [
          {
            id: QUESTION,
            category_id: CATEGORY,
            correct_index: 2,
            point_value: 200,
            played_at: "2026-11-04T19:59:34.000+00:00",
            finished_at: null,
          },
        ],
        categories: [{ id: CATEGORY, game_id: GAME }],
        games: [{ id: GAME, night_id: NIGHT }],
        nights: [night],
        reveals: [
          {
            id: "resolve-row",
            question_id: QUESTION,
            event: "resolve",
            occurred_at: "2026-11-04T20:00:00+00:00",
            metadata: { correct_index: 2, point_value: 200 },
          },
        ],
        answers: [
          { id: "unscored", question_id: QUESTION, chosen_index: 2, ms_to_lock: 25, locked_at: "2026-11-04T19:59:35+00:00", is_correct: null },
        ],
      };
    }

    const resolve = () =>
      postResolve(
        jsonPost(`/api/questions/${QUESTION}/resolve`, {}, { "x-tr1via-close-caller": "phone" }),
        { params: Promise.resolve({ id: QUESTION }) },
      );

    it("/resolve stamps the resolve row for the winner, and runs no repair", async () => {
      const data = seed();
      adminMock.getSupabaseAdmin.mockReturnValue(fakeLiveAdmin(data));
      const res = await resolve();
      expect(res.status).toBe(200);
      expect(data.reveals[0]?.metadata).toEqual({
        correct_index: 2,
        point_value: 200,
        closed_by: "phone",
        late_ms: 1_000,
      });
      expect(data.answers[0]?.is_correct).toBeNull();
    });

    it("/resolve writes nothing for a loser", async () => {
      const admin = fakeLiveAdmin(seed(), { rpc: async () => ({ data: false, error: null }) });
      adminMock.getSupabaseAdmin.mockReturnValue(admin);
      await resolve();
      expect(admin.writes).toEqual([]);
    });

    it("end-early stamps the resolve row for the winner", async () => {
      const data = seed();
      adminMock.getSupabaseAdmin.mockReturnValue(fakeLiveAdmin(data));
      const res = await postEndEarly(
        jsonPost(`/api/games/${GAME}/end-early`, { questionId: QUESTION }),
        { params: Promise.resolve({ id: GAME }) },
      );
      expect(res.status).toBe(200);
      expect(data.reveals[0]?.metadata).toMatchObject({ correct_index: 2, closed_by: "host" });
    });
  });

  describe("POST /api/players/:id/heartbeat", () => {
    const context = { params: Promise.resolve({ id: PLAYER }) };
    const beat = (body?: unknown) =>
      postHeartbeat(
        new NextRequest(`http://test/api/players/${PLAYER}/heartbeat`, {
          method: "POST",
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        context,
      );

    beforeEach(() => {
      authMock.requireOwnedPlayerReference.mockReset().mockResolvedValue({
        ok: true,
        player: { id: PLAYER, night_id: NIGHT, removed_at: null, app_switch_total_seconds: 0 },
      });
      adminMock.getSupabaseAdmin.mockReturnValue(
        fakeLiveAdmin({ players: [{ id: PLAYER }] }),
      );
    });

    it("logs the phone's numbers", async () => {
      const res = await beat({ resendCount: 3, longestReplyWaitMs: 6_200, secondsAtZero: 4 });
      expect(res.status).toBe(204);
      expect(logged(info, "phone_stats")).toEqual([
        { kind: "phone_stats", nightId: NIGHT, resendCount: 3, longestReplyWaitMs: 6_200, secondsAtZero: 4 },
      ]);
    });

    it("logs nothing for a bare heartbeat or an app-switch report", async () => {
      await beat();
      await beat({ appSwitchSeconds: 5 });
      expect(logged(info, "phone_stats")).toEqual([]);
    });

    it("refuses numbers out of range", async () => {
      const res = await beat({ resendCount: -1 });
      expect(res.status).toBe(400);
    });
  });
});
