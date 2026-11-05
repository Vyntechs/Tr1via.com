import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const broadcastMock = vi.hoisted(() => ({ broadcastToRoom: vi.fn() }));
const afterMock = vi.hoisted(() => ({
  pending: [] as Array<() => Promise<unknown>>,
  afterReply: vi.fn(),
}));

vi.mock("@/lib/api/broadcast", () => broadcastMock);
vi.mock("@/lib/live/afterReply", () => ({ afterReply: afterMock.afterReply }));

import { awardPoints } from "@/lib/game/score";
import {
  repairAfterReply,
  repairQuestionScores,
  repairQuestionScoresCapped,
  scoreLateAnswers,
  sweepLastFinishedAfterReply,
} from "@/lib/live/scoreLateAnswers";
import { fakeLiveAdmin } from "./helpers/fakeLiveAdmin";

const QUESTION = "q-1";
const FINISHED_AT = "2026-11-04T20:00:25.400+00:00";
const FINISHED_MS = Date.parse(FINISHED_AT);
const target = { questionId: QUESTION, nightId: "night-1", roomCode: "ABCDEF" };

type Admin = Parameters<typeof scoreLateAnswers>[0];
const asAdmin = (fake: ReturnType<typeof fakeLiveAdmin>) => fake as unknown as Admin;

function answer(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    question_id: QUESTION,
    chosen_index: 2,
    ms_to_lock: 24_900,
    locked_at: "2026-11-04T20:00:24.900+00:00",
    is_correct: null,
    awarded_points: null,
    ...overrides,
  };
}

function seed(answers: Record<string, unknown>[], question: Record<string, unknown> = {}) {
  return {
    questions: [
      { id: QUESTION, correct_index: 2, point_value: 300, finished_at: FINISHED_AT, ...question },
    ],
    answers,
  };
}

function logged(info: { mock: { calls: unknown[][] } }, kind: string) {
  return info.mock.calls
    .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
    .filter((event) => event.kind === kind);
}

async function runPendingAfterWork() {
  const work = afterMock.pending.splice(0).map((run) => run());
  await vi.advanceTimersByTimeAsync(2_000);
  await Promise.all(work);
}

describe("late answer scoring", () => {
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ now: FINISHED_MS + 500 });
    vi.stubEnv("LIVE_CLOSE_MODE", "on");
    broadcastMock.broadcastToRoom.mockReset().mockResolvedValue(undefined);
    afterMock.pending.length = 0;
    afterMock.afterReply.mockReset().mockImplementation((work) => {
      afterMock.pending.push(work);
    });
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("scores from the stored choice and time, right, right and fast, and wrong", async () => {
    const data = seed([
      answer("slow"),
      answer("fast", { ms_to_lock: 4_999 }),
      answer("wrong", { chosen_index: 1, ms_to_lock: 100 }),
      answer("done", { is_correct: true, awarded_points: 111 }),
    ]);
    const admin = fakeLiveAdmin(data);
    await expect(scoreLateAnswers(asAdmin(admin), QUESTION)).resolves.toBe(3);
    expect(data.answers.map((a) => [a.id, a.is_correct, a.awarded_points])).toEqual([
      ["slow", true, 300],
      ["fast", true, 330],
      ["wrong", false, 0],
      ["done", true, 111],
    ]);
  });

  it("updates each row only while it is still unscored", async () => {
    const admin = fakeLiveAdmin(seed([answer("a-1")]));
    await scoreLateAnswers(asAdmin(admin), QUESTION);
    expect(admin.writes).toHaveLength(1);
    expect(admin.writes[0]?.filters).toEqual([
      ["eq", "id", "a-1"],
      ["is", "is_correct", null],
    ]);
  });

  it("doesn't count a row someone else got to first", async () => {
    const data = seed([answer("a-1")]);
    const admin = fakeLiveAdmin(data, {
      // Taken just after this repair read it, so the guarded update matches nothing.
      before: (table, op) => {
        if (table === "answers" && op === "read") data.answers[0]!.is_correct = true;
      },
    });
    await expect(scoreLateAnswers(asAdmin(admin), QUESTION)).resolves.toBe(0);
    expect(data.answers[0]?.awarded_points).toBeNull();
  });

  it("leaves a question that hasn't finished alone", async () => {
    const admin = fakeLiveAdmin(seed([answer("a-1")], { finished_at: null }));
    await expect(scoreLateAnswers(asAdmin(admin), QUESTION)).resolves.toBe(0);
    expect(admin.reads).not.toContain("answers");
    expect(admin.writes).toEqual([]);
  });

  it("leaves questions finished 10 minutes ago or more alone", async () => {
    vi.setSystemTime(FINISHED_MS + 10 * 60_000);
    const admin = fakeLiveAdmin(seed([answer("a-1")]));
    await expect(scoreLateAnswers(asAdmin(admin), QUESTION)).resolves.toBe(0);
    expect(admin.writes).toEqual([]);

    vi.setSystemTime(FINISHED_MS + 10 * 60_000 - 1);
    await expect(scoreLateAnswers(asAdmin(admin), QUESTION)).resolves.toBe(1);
  });

  it("logs any row locked at or after the close", async () => {
    const admin = fakeLiveAdmin(
      seed([
        answer("before"),
        answer("at", { locked_at: FINISHED_AT }),
        answer("after", { locked_at: "2026-11-04T20:00:25.430+00:00" }),
      ]),
    );
    await scoreLateAnswers(asAdmin(admin), QUESTION);
    expect(logged(info, "late_scored")).toEqual([
      { kind: "late_scored", questionId: QUESTION, answerId: "at", msPastClose: 0 },
      { kind: "late_scored", questionId: QUESTION, answerId: "after", msPastClose: 30 },
    ]);
  });

  it("never writes to reveals", async () => {
    const admin = fakeLiveAdmin(seed([answer("a-1")]));
    await repairQuestionScores(asAdmin(admin), target);
    await runPendingAfterWork();
    expect(admin.writes.map((write) => write.table)).toEqual(["answers"]);
    expect(admin.from).not.toHaveBeenCalledWith("reveals");
  });

  describe("the refetch hint", () => {
    it("goes out once, 2s after a repair that wrote rows", async () => {
      const admin = fakeLiveAdmin(seed([answer("a-1"), answer("a-2")]));
      await repairQuestionScores(asAdmin(admin), target);
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();

      const work = afterMock.pending.splice(0).map((run) => run());
      await vi.advanceTimersByTimeAsync(1_999);
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await Promise.all(work);
      expect(broadcastMock.broadcastToRoom).toHaveBeenCalledTimes(1);
      expect(broadcastMock.broadcastToRoom.mock.calls[0]?.slice(0, 2)).toEqual([
        "ABCDEF",
        "scores-refetch",
      ]);
    });

    it("isn't sent when nothing was written", async () => {
      const admin = fakeLiveAdmin(seed([answer("a-1", { is_correct: false })]));
      await repairQuestionScores(asAdmin(admin), target);
      await runPendingAfterWork();
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
    });

    it("is shared by repairs that land while one is waiting", async () => {
      await repairQuestionScores(asAdmin(fakeLiveAdmin(seed([answer("a-1")]))), target);
      await repairQuestionScores(asAdmin(fakeLiveAdmin(seed([answer("a-2")]))), target);
      await runPendingAfterWork();
      expect(broadcastMock.broadcastToRoom).toHaveBeenCalledTimes(1);
    });

    it("doesn't throw when the broadcast fails", async () => {
      broadcastMock.broadcastToRoom.mockRejectedValue(new Error("no ack"));
      await repairQuestionScores(asAdmin(fakeLiveAdmin(seed([answer("a-1")]))), target);
      await expect(runPendingAfterWork()).resolves.toBeUndefined();
    });
  });

  describe("switches", () => {
    it("off reads nothing and schedules nothing", async () => {
      vi.stubEnv("LIVE_CLOSE_MODE", "off");
      const admin = fakeLiveAdmin(seed([answer("a-1")]));
      await repairQuestionScores(asAdmin(admin), target);
      await repairQuestionScoresCapped(asAdmin(admin), target);
      repairAfterReply(asAdmin(admin), target);
      sweepLastFinishedAfterReply(asAdmin(admin), { gameId: "g-1", nightId: "night-1", roomCode: "ABCDEF" });
      expect(admin.from).not.toHaveBeenCalled();
      expect(afterMock.afterReply).not.toHaveBeenCalled();
    });

    it("shadow counts and logs, with no write and no hint", async () => {
      vi.stubEnv("LIVE_CLOSE_MODE", "shadow");
      const admin = fakeLiveAdmin(seed([answer("a-1"), answer("a-2")]));
      await repairQuestionScores(asAdmin(admin), target);
      expect(admin.writes).toEqual([]);
      expect(afterMock.afterReply).not.toHaveBeenCalled();
      expect(logged(info, "score_repair")).toEqual([
        { kind: "score_repair", questionId: QUESTION, rows: 2, dryRun: true },
      ]);
    });
  });

  describe("the sweep at the next reveal and at game end", () => {
    const sweep = { gameId: "g-1", nightId: "night-1", roomCode: "ABCDEF" };

    function gameSeed() {
      return {
        categories: [
          { id: "c-1", game_id: "g-1" },
          { id: "c-other", game_id: "g-2" },
        ],
        questions: [
          { id: "q-older", category_id: "c-1", correct_index: 2, point_value: 100, finished_at: "2026-11-04T19:59:00.000+00:00" },
          { id: QUESTION, category_id: "c-1", correct_index: 2, point_value: 300, finished_at: FINISHED_AT },
          { id: "q-live", category_id: "c-1", correct_index: 2, point_value: 500, finished_at: null },
          { id: "q-other-game", category_id: "c-other", correct_index: 2, point_value: 700, finished_at: "2026-11-04T20:00:25.450+00:00" },
        ],
        answers: [
          answer("older", { question_id: "q-older" }),
          answer("last"),
          answer("live", { question_id: "q-live" }),
          answer("other", { question_id: "q-other-game" }),
        ],
      };
    }

    it("repairs only the game's most recently finished question", async () => {
      const data = gameSeed();
      sweepLastFinishedAfterReply(asAdmin(fakeLiveAdmin(data)), sweep);
      await runPendingAfterWork();
      expect(data.answers.filter((a) => a.is_correct !== null).map((a) => a.id)).toEqual(["last"]);
    });
  });

  it("the capped form stops waiting after 1s and asks after() to carry on", async () => {
    const admin = fakeLiveAdmin(seed([answer("a-1")]), {
      before: () => new Promise<void>(() => {}),
    });
    let replied = false;
    void repairQuestionScoresCapped(asAdmin(admin), target).then(() => {
      replied = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(replied).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(replied).toBe(true);
    expect(afterMock.afterReply).toHaveBeenCalledTimes(1);
  });

  // resolve_question's rule, written out as SQL has it (numeric math, so exact),
  // beside the TypeScript copy. Any drift between the two fails here.
  it("matches the SQL rule at all seven point values and every timing edge", () => {
    const sqlPoints = (pointValue: number, correct: boolean, msToLock: number | null) => {
      if (!correct) return 0;
      if (msToLock !== null && msToLock < 5_000) return Math.floor((pointValue * 11) / 10);
      return pointValue;
    };
    for (const pointValue of [100, 200, 300, 400, 500, 600, 700]) {
      for (const msToLock of [0, 4_999, 5_000, 24_999, null]) {
        for (const correct of [true, false]) {
          expect(awardPoints({ pointValue, correct, msToLock })).toBe(
            sqlPoints(pointValue, correct, msToLock),
          );
        }
      }
    }
  });
});
