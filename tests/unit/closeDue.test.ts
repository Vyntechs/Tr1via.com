import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const broadcastMock = vi.hoisted(() => ({
  broadcastToRoom: vi.fn(),
  broadcastFireworks: vi.fn(),
}));
const afterMock = vi.hoisted(() => ({
  pending: [] as Array<() => Promise<unknown>>,
  afterReply: vi.fn(),
}));

vi.mock("@/lib/api/broadcast", () => broadcastMock);
vi.mock("@/lib/live/afterReply", () => ({ afterReply: afterMock.afterReply }));

import {
  clearCloseTicksForTest,
  closeOverdueOnTick,
  closeQuestionIfDue,
  runCloseAlarm,
} from "@/lib/live/closeDue";
import { fakeLiveAdmin } from "./helpers/fakeLiveAdmin";

const QUESTION = "q-1";
const NIGHT = "night-1";
const ROOM = "ABCDEF";
const PLAYED_AT = "2026-11-04T20:00:00.000Z";
const PLAYED_MS = Date.parse(PLAYED_AT);
const DUE_MS = PLAYED_MS + 25_000 + 1_200;

type Admin = Parameters<typeof closeQuestionIfDue>[0];
const asAdmin = (fake: ReturnType<typeof fakeLiveAdmin>) => fake as unknown as Admin;

function seed(question: Record<string, unknown> = {}) {
  return {
    questions: [
      {
        id: QUESTION,
        played_at: "2026-11-04T20:00:00+00:00",
        finished_at: null as string | null,
        correct_index: 2,
        point_value: 300,
        ...question,
      },
    ],
    reveals: [
      {
        id: "r-old",
        question_id: QUESTION,
        event: "resolve",
        occurred_at: "2026-11-04T19:00:00+00:00",
        metadata: { correct_index: 0 },
      },
      {
        id: "r-new",
        question_id: QUESTION,
        event: "resolve",
        occurred_at: "2026-11-04T20:00:26+00:00",
        metadata: { correct_index: 2, point_value: 300 },
      },
    ],
    answers: [] as Record<string, unknown>[],
  };
}

const input = {
  questionId: QUESTION,
  expectedPlayedAt: PLAYED_AT,
  nightId: NIGHT,
  roomCode: ROOM,
  source: "room-tick" as const,
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

describe("the server closer", () => {
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ now: DUE_MS });
    vi.stubEnv("LIVE_CLOSE_MODE", "on");
    vi.stubEnv("LIVE_CLOSE_NIGHTS", "");
    broadcastMock.broadcastToRoom.mockReset().mockResolvedValue(undefined);
    broadcastMock.broadcastFireworks.mockReset().mockResolvedValue(undefined);
    afterMock.pending.length = 0;
    afterMock.afterReply.mockReset().mockImplementation((work) => {
      afterMock.pending.push(work);
    });
    clearCloseTicksForTest();
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("stops without touching anything", () => {
    it("before deadline + 1,200ms, and goes at exactly that moment", async () => {
      vi.setSystemTime(DUE_MS - 1);
      const early = fakeLiveAdmin(seed());
      await expect(closeQuestionIfDue(asAdmin(early), input)).resolves.toBe("not_due");
      expect(early.rpc).not.toHaveBeenCalled();
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();

      vi.setSystemTime(DUE_MS);
      const due = fakeLiveAdmin(seed());
      await expect(closeQuestionIfDue(asAdmin(due), input)).resolves.toBe("won");
    });

    it("when played_at no longer matches, because undo and re-reveal moved it", async () => {
      const admin = fakeLiveAdmin(seed({ played_at: "2026-11-04T20:00:09+00:00" }));
      await expect(closeQuestionIfDue(asAdmin(admin), input)).resolves.toBe("stale");
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
    });

    it("when undo cleared played_at or the question is gone", async () => {
      const cleared = fakeLiveAdmin(seed({ played_at: null }));
      await expect(closeQuestionIfDue(asAdmin(cleared), input)).resolves.toBe("stale");
      const gone = fakeLiveAdmin({ questions: [] });
      await expect(closeQuestionIfDue(asAdmin(gone), input)).resolves.toBe("stale");
      expect(cleared.rpc).not.toHaveBeenCalled();
      expect(gone.rpc).not.toHaveBeenCalled();
    });

    it("when the question already finished", async () => {
      const admin = fakeLiveAdmin(seed({ finished_at: "2026-11-04T20:00:25.300+00:00" }));
      await expect(closeQuestionIfDue(asAdmin(admin), input)).resolves.toBe("lost");
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
      expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
    });

    it("when played_at is 10 minutes old or more", async () => {
      vi.setSystemTime(PLAYED_MS + 10 * 60_000);
      const admin = fakeLiveAdmin(seed());
      await expect(closeQuestionIfDue(asAdmin(admin), input)).resolves.toBe("stale");
      expect(admin.rpc).not.toHaveBeenCalled();
    });
  });

  it("reads the same instant written two ways as a match", async () => {
    const admin = fakeLiveAdmin(seed({ played_at: "2026-11-04T20:00:00+00:00" }));
    await expect(
      closeQuestionIfDue(asAdmin(admin), { ...input, expectedPlayedAt: "2026-11-04T20:00:00.000Z" }),
    ).resolves.toBe("won");
  });

  describe("a win", () => {
    it("sends exactly one resolve and one salvo, then logs who closed it", async () => {
      const admin = fakeLiveAdmin(seed());
      await expect(closeQuestionIfDue(asAdmin(admin), input)).resolves.toBe("won");

      expect(admin.rpc).toHaveBeenCalledTimes(1);
      expect(admin.rpc).toHaveBeenCalledWith("resolve_question_once", { p_question_id: QUESTION });
      expect(resolveBroadcasts()).toEqual([
        [
          ROOM,
          "resolve",
          {
            questionId: QUESTION,
            correctIndex: 2,
            refetch: true,
            serverNow: new Date(DUE_MS).toISOString(),
          },
        ],
      ]);
      expect(broadcastMock.broadcastFireworks.mock.calls).toEqual([[ROOM, "salvo", QUESTION]]);
      expect(logged(info, "close")).toEqual([
        { kind: "close", questionId: QUESTION, roomCode: ROOM, closedBy: "room-tick", lateMs: 1_200 },
      ]);
    });

    it("merges closed_by and late_ms into the newest resolve row only", async () => {
      const data = seed();
      const admin = fakeLiveAdmin(data);
      await closeQuestionIfDue(asAdmin(admin), input);

      const [oldRow, newRow] = data.reveals;
      expect(newRow?.metadata).toEqual({
        correct_index: 2,
        point_value: 300,
        closed_by: "room-tick",
        late_ms: 1_200,
      });
      expect(oldRow?.metadata).toEqual({ correct_index: 0 });
      expect(admin.writes.filter((w) => w.table === "reveals")).toHaveLength(1);
    });

    it("runs the repair after the broadcast", async () => {
      const order: string[] = [];
      broadcastMock.broadcastToRoom.mockImplementation(async (_r, event) => {
        order.push(String(event));
      });
      broadcastMock.broadcastFireworks.mockImplementation(async () => {
        order.push("salvo");
      });
      const data = seed({ finished_at: null });
      const admin = fakeLiveAdmin(data, {
        rpc: async () => {
          data.questions[0]!.finished_at = new Date(DUE_MS).toISOString();
          return { data: true, error: null };
        },
        before: (table) => {
          if (table === "answers") order.push("repair");
        },
      });
      await closeQuestionIfDue(asAdmin(admin), input);
      expect(order).toEqual(["resolve", "salvo", "repair"]);
    });

    it("gives up waiting on a stuck repair after 1s, and still reports the win", async () => {
      const data = seed();
      const admin = fakeLiveAdmin(data, {
        rpc: async () => {
          data.questions[0]!.finished_at = new Date(DUE_MS).toISOString();
          return { data: true, error: null };
        },
        before: (table) => (table === "answers" ? new Promise<void>(() => {}) : undefined),
      });
      let outcome: string | null = null;
      void closeQuestionIfDue(asAdmin(admin), input).then((value) => {
        outcome = value;
      });
      await vi.advanceTimersByTimeAsync(999);
      expect(outcome).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(outcome).toBe("won");
    });

    it("never retries a failed broadcast, and the close still counts", async () => {
      broadcastMock.broadcastToRoom.mockRejectedValue(new Error("no ack"));
      const admin = fakeLiveAdmin(seed());
      await expect(closeQuestionIfDue(asAdmin(admin), input)).resolves.toBe("won");
      expect(resolveBroadcasts()).toHaveLength(1);
      expect(broadcastMock.broadcastFireworks).toHaveBeenCalledTimes(1);
      expect(logged(info, "close")).toHaveLength(1);
    });

    it("survives a failed salvo and a failed close record", async () => {
      broadcastMock.broadcastFireworks.mockRejectedValue(new Error("no ack"));
      const admin = fakeLiveAdmin(seed(), {
        updateError: { reveals: { message: "nope" } },
      });
      await expect(closeQuestionIfDue(asAdmin(admin), input)).resolves.toBe("won");
    });
  });

  describe("losing the race", () => {
    it("broadcasts nothing, logs nothing, repairs nothing", async () => {
      const admin = fakeLiveAdmin(seed(), { rpc: async () => ({ data: false, error: null }) });
      await expect(closeQuestionIfDue(asAdmin(admin), input)).resolves.toBe("lost");
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
      expect(broadcastMock.broadcastFireworks).not.toHaveBeenCalled();
      expect(logged(info, "close")).toEqual([]);
      expect(admin.writes).toEqual([]);
      expect(admin.reads).not.toContain("answers");
    });

    it("gives one broadcast between many closers when the database picks one winner", async () => {
      let won = false;
      const admin = fakeLiveAdmin(seed(), {
        rpc: async () => {
          const first = !won;
          won = true;
          return { data: first, error: null };
        },
      });
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, () => closeQuestionIfDue(asAdmin(admin), input)),
      );
      expect(outcomes.filter((outcome) => outcome === "won")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === "lost")).toHaveLength(4);
      expect(resolveBroadcasts()).toHaveLength(1);
      expect(broadcastMock.broadcastFireworks).toHaveBeenCalledTimes(1);
    });
  });

  describe("database errors", () => {
    it("treats P0001 as a clean stop, with no retry", async () => {
      const admin = fakeLiveAdmin(seed(), {
        rpc: async () => ({ data: null, error: { code: "P0001", message: "never revealed" } }),
      });
      await expect(closeQuestionIfDue(asAdmin(admin), input)).resolves.toBe("stale");
      expect(admin.rpc).toHaveBeenCalledTimes(1);
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
    });

    it("waits 500ms, reads again and retries once on any other error", async () => {
      const results = [
        { data: null, error: { code: "57014", message: "timeout" } },
        { data: true, error: null },
      ];
      const admin = fakeLiveAdmin(seed(), { rpc: async () => results.shift()! });
      const closing = closeQuestionIfDue(asAdmin(admin), input);
      await vi.advanceTimersByTimeAsync(499);
      expect(admin.rpc).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(closing).resolves.toBe("won");
      expect(admin.rpc).toHaveBeenCalledTimes(2);
      expect(resolveBroadcasts()).toHaveLength(1);
    });

    it("skips the retry when the re-read shows someone else closed it", async () => {
      const data = seed();
      const admin = fakeLiveAdmin(data, {
        rpc: async () => {
          data.questions[0]!.finished_at = "2026-11-04T20:00:26.300+00:00";
          return { data: null, error: { code: "57014", message: "timeout" } };
        },
      });
      const closing = closeQuestionIfDue(asAdmin(admin), input);
      await vi.advanceTimersByTimeAsync(500);
      await expect(closing).resolves.toBe("lost");
      expect(admin.rpc).toHaveBeenCalledTimes(1);
    });

    it("stops after one retry", async () => {
      const admin = fakeLiveAdmin(seed(), {
        rpc: async () => ({ data: null, error: { code: "57014", message: "timeout" } }),
      });
      const closing = closeQuestionIfDue(asAdmin(admin), input);
      await vi.advanceTimersByTimeAsync(500);
      await expect(closing).resolves.toBe("error");
      expect(admin.rpc).toHaveBeenCalledTimes(2);
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
    });

    it("has no fallback when the function is missing", async () => {
      const admin = fakeLiveAdmin(seed(), {
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "missing" } }),
      });
      const closing = closeQuestionIfDue(asAdmin(admin), input);
      await vi.advanceTimersByTimeAsync(500);
      await expect(closing).resolves.toBe("error");
      expect(admin.rpc.mock.calls.every(([name]) => name === "resolve_question_once")).toBe(true);
    });
  });

  describe("switches", () => {
    it("off reads nothing", async () => {
      vi.stubEnv("LIVE_CLOSE_MODE", "off");
      const admin = fakeLiveAdmin(seed());
      await expect(closeQuestionIfDue(asAdmin(admin), input)).resolves.toBe("off");
      expect(admin.from).not.toHaveBeenCalled();
    });

    it("unset, or any unknown word, is off", async () => {
      vi.stubEnv("LIVE_CLOSE_MODE", "");
      await expect(closeQuestionIfDue(asAdmin(fakeLiveAdmin(seed())), input)).resolves.toBe("off");
      vi.stubEnv("LIVE_CLOSE_MODE", "ON");
      await expect(closeQuestionIfDue(asAdmin(fakeLiveAdmin(seed())), input)).resolves.toBe("off");
    });

    it("shadow logs what it would have closed and changes nothing", async () => {
      vi.stubEnv("LIVE_CLOSE_MODE", "shadow");
      const admin = fakeLiveAdmin(seed());
      await expect(closeQuestionIfDue(asAdmin(admin), input)).resolves.toBe("shadow");
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(admin.writes).toEqual([]);
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
      expect(logged(info, "would_close")).toEqual([
        { kind: "would_close", questionId: QUESTION, roomCode: ROOM, source: "room-tick", lateMs: 1_200 },
      ]);
    });

    it("shadow says nothing when the question isn't due", async () => {
      vi.stubEnv("LIVE_CLOSE_MODE", "shadow");
      vi.setSystemTime(DUE_MS - 1);
      await closeQuestionIfDue(asAdmin(fakeLiveAdmin(seed())), input);
      expect(logged(info, "would_close")).toEqual([]);
    });

    it("the allow-list leaves other nights off", async () => {
      vi.stubEnv("LIVE_CLOSE_NIGHTS", "night-2, night-3");
      const other = fakeLiveAdmin(seed());
      await expect(closeQuestionIfDue(asAdmin(other), input)).resolves.toBe("off");
      expect(other.from).not.toHaveBeenCalled();

      await expect(
        closeQuestionIfDue(asAdmin(fakeLiveAdmin(seed())), { ...input, nightId: "night-3" }),
      ).resolves.toBe("won");
    });
  });

  describe("snapshot ticks", () => {
    const tick = (overrides: Record<string, unknown> = {}) => ({
      answerEngine: "legacy",
      gameIsLive: true,
      question: { id: QUESTION, played_at: PLAYED_AT },
      nightId: NIGHT,
      roomCode: ROOM,
      source: "tv-tick" as const,
      ...overrides,
    });

    it("closes an overdue question inline, so the close is done before the reply", async () => {
      const admin = fakeLiveAdmin(seed());
      await closeOverdueOnTick(asAdmin(admin), tick());
      expect(admin.rpc).toHaveBeenCalledTimes(1);
      expect(resolveBroadcasts()).toHaveLength(1);
    });

    it.each([
      ["a resilient night", { answerEngine: "resilient_v1" }],
      ["a game that isn't live", { gameIsLive: false }],
      ["no live question", { question: null }],
    ])("costs no database call for %s", async (_name, overrides) => {
      const admin = fakeLiveAdmin(seed());
      await closeOverdueOnTick(asAdmin(admin), tick(overrides));
      expect(admin.from).not.toHaveBeenCalled();
    });

    it("costs no database call before the question is overdue, or when off", async () => {
      const admin = fakeLiveAdmin(seed());
      vi.setSystemTime(DUE_MS - 1);
      await closeOverdueOnTick(asAdmin(admin), tick());
      vi.setSystemTime(DUE_MS);
      vi.stubEnv("LIVE_CLOSE_MODE", "off");
      await closeOverdueOnTick(asAdmin(admin), tick());
      expect(admin.from).not.toHaveBeenCalled();
    });

    it("allows one attempt per question per 500ms", async () => {
      const admin = fakeLiveAdmin(seed(), { rpc: async () => ({ data: false, error: null }) });
      await closeOverdueOnTick(asAdmin(admin), tick());
      await closeOverdueOnTick(asAdmin(admin), tick());
      vi.setSystemTime(DUE_MS + 499);
      await closeOverdueOnTick(asAdmin(admin), tick());
      expect(admin.rpc).toHaveBeenCalledTimes(1);
      vi.setSystemTime(DUE_MS + 500);
      await closeOverdueOnTick(asAdmin(admin), tick());
      expect(admin.rpc).toHaveBeenCalledTimes(2);
    });

    it("holds the reply 1,500ms at most, and hands the rest to after()", async () => {
      const admin = fakeLiveAdmin(seed(), { rpc: () => new Promise(() => {}) });
      let replied = false;
      void closeOverdueOnTick(asAdmin(admin), tick()).then(() => {
        replied = true;
      });
      await vi.advanceTimersByTimeAsync(1_499);
      expect(replied).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(replied).toBe(true);
      expect(afterMock.afterReply).toHaveBeenCalledTimes(1);
    });
  });

  describe("the alarm", () => {
    const alarm = {
      questionId: QUESTION,
      expectedPlayedAt: PLAYED_AT,
      nightId: NIGHT,
      roomCode: ROOM,
    };

    it("sleeps to played_at + 26.2s, closes, and logs a win", async () => {
      vi.setSystemTime(PLAYED_MS + 40);
      const admin = fakeLiveAdmin(seed());
      const waking = runCloseAlarm(asAdmin(admin), alarm);
      await vi.advanceTimersByTimeAsync(26_159);
      expect(admin.from).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await waking;
      expect(admin.rpc).toHaveBeenCalledTimes(1);
      expect(logged(info, "alarm_wake")).toEqual([
        { kind: "alarm_wake", questionId: QUESTION, outcome: "won", lateMs: 0 },
      ]);
      expect(logged(info, "close")[0]?.closedBy).toBe("alarm");
    });

    it("logs a loss when a browser closed it first", async () => {
      const admin = fakeLiveAdmin(seed({ finished_at: "2026-11-04T20:00:25.300+00:00" }));
      await runCloseAlarm(asAdmin(admin), alarm);
      expect(logged(info, "alarm_wake")[0]?.outcome).toBe("lost");
      expect(broadcastMock.broadcastToRoom).not.toHaveBeenCalled();
    });

    it("logs stale after an undo and re-reveal, and leaves the new play alone", async () => {
      const admin = fakeLiveAdmin(seed({ played_at: "2026-11-04T20:00:11+00:00" }));
      await runCloseAlarm(asAdmin(admin), alarm);
      expect(logged(info, "alarm_wake")[0]?.outcome).toBe("stale");
      expect(admin.rpc).not.toHaveBeenCalled();
    });

    it("logs how late it woke", async () => {
      vi.setSystemTime(DUE_MS + 340);
      await runCloseAlarm(asAdmin(fakeLiveAdmin(seed())), alarm);
      expect(logged(info, "alarm_wake")[0]?.lateMs).toBe(340);
    });

    it("isn't silenced by a tick that just used up the 500ms slot", async () => {
      const lost = fakeLiveAdmin(seed(), { rpc: async () => ({ data: false, error: null }) });
      await closeOverdueOnTick(asAdmin(lost), {
        answerEngine: "legacy",
        gameIsLive: true,
        question: { id: QUESTION, played_at: PLAYED_AT },
        nightId: NIGHT,
        roomCode: ROOM,
        source: "room-tick",
      });
      const admin = fakeLiveAdmin(seed());
      await runCloseAlarm(asAdmin(admin), alarm);
      expect(admin.rpc).toHaveBeenCalledTimes(1);
    });

    it("still logs the wake when the closer throws", async () => {
      const admin = fakeLiveAdmin(seed(), {
        before: () => {
          throw new Error("socket closed");
        },
      });
      await runCloseAlarm(asAdmin(admin), alarm);
      expect(logged(info, "alarm_wake")[0]?.outcome).toBe("error");
    });

    it("in shadow mode wakes, logs, and writes nothing", async () => {
      vi.stubEnv("LIVE_CLOSE_MODE", "shadow");
      const admin = fakeLiveAdmin(seed());
      await runCloseAlarm(asAdmin(admin), alarm);
      expect(logged(info, "alarm_wake")[0]?.outcome).toBe("shadow");
      expect(admin.rpc).not.toHaveBeenCalled();
      expect(admin.writes).toEqual([]);
    });
  });
});
