import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSE_DUE_AFTER_MS,
  closeQuestionIfDue,
  liveCloseMode,
  liveCloseNightAllowed,
  tickCloseIfDue,
  type CloseDeps,
  type CloseRequest,
} from "@/lib/live/closeDue";

const PLAYED_AT = "2026-11-04T20:00:00.000Z";
const PLAYED_MS = Date.parse(PLAYED_AT);
const DUE_MS = PLAYED_MS + 25_000 + CLOSE_DUE_AFTER_MS;

type Row = { played_at: string | null; finished_at: string | null; correct_index: number };
type RpcReply = { data: unknown; error: { code?: string } | null };
type Admin = Parameters<typeof closeQuestionIfDue>[0];

const LIVE_ROW: Row = { played_at: PLAYED_AT, finished_at: null, correct_index: 2 };
const WON: RpcReply = { data: true, error: null };

function fakeAdmin(rows: Row[] = [LIVE_ROW], replies: RpcReply[] = [WON]) {
  let reads = 0;
  const read = vi.fn(async () => ({
    data: rows[Math.min(reads++, rows.length - 1)],
    error: null,
  }));
  let calls = 0;
  const rpc = vi.fn(async () => replies[Math.min(calls++, replies.length - 1)]);
  const admin = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: read }) }) }),
    rpc,
  } as unknown as Admin;
  return { admin, read, rpc };
}

function fakeDeps(nowMs = DUE_MS) {
  const lines: Array<Record<string, unknown>> = [];
  const deps = {
    now: () => nowMs,
    sleep: vi.fn(async () => undefined),
    broadcastResolve: vi.fn(async () => undefined),
    broadcastSalvo: vi.fn(async () => undefined),
    sink: (line: string) => lines.push(JSON.parse(line)),
  } satisfies CloseDeps;
  return { deps, lines };
}

let nextQuestion = 0;
function request(): CloseRequest {
  nextQuestion += 1;
  return {
    questionId: `q-${nextQuestion}`,
    expectedPlayedAt: PLAYED_AT,
    roomCode: "ABCDEF",
    source: "snapshot-tick",
    themeKey: undefined,
  };
}

beforeEach(() => {
  vi.stubEnv("LIVE_CLOSE_MODE", "on");
  vi.stubEnv("LIVE_CLOSE_NIGHTS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("closeQuestionIfDue", () => {
  it("stops one millisecond before deadline plus 1,200ms and closes on it", async () => {
    const early = fakeAdmin();
    const { deps } = fakeDeps(DUE_MS - 1);
    await expect(closeQuestionIfDue(early.admin, request(), deps)).resolves.toBe("not-overdue");
    expect(early.rpc).not.toHaveBeenCalled();
    expect(deps.broadcastResolve).not.toHaveBeenCalled();

    const due = fakeAdmin();
    await expect(closeQuestionIfDue(due.admin, request(), fakeDeps(DUE_MS).deps)).resolves.toBe("closed");
    expect(due.rpc).toHaveBeenCalledTimes(1);
  });

  it("stops when played_at moved, because the host undid or re-revealed it", async () => {
    for (const played_at of [null, "2026-11-04T20:00:09.000Z"]) {
      const { admin, rpc } = fakeAdmin([{ ...LIVE_ROW, played_at }]);
      const { deps } = fakeDeps();
      await expect(closeQuestionIfDue(admin, request(), deps)).resolves.toBe("stale-played-at");
      expect(rpc).not.toHaveBeenCalled();
      expect(deps.broadcastResolve).not.toHaveBeenCalled();
    }
  });

  it("matches played_at by instant, not by how the time is written", async () => {
    const { admin } = fakeAdmin([{ ...LIVE_ROW, played_at: "2026-11-04T20:00:00+00:00" }]);
    await expect(closeQuestionIfDue(admin, request(), fakeDeps().deps)).resolves.toBe("closed");
  });

  it("stops on a question revealed ten minutes ago or more", async () => {
    const { admin, rpc } = fakeAdmin();
    await expect(
      closeQuestionIfDue(admin, request(), fakeDeps(PLAYED_MS + 600_000).deps),
    ).resolves.toBe("too-old");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stops on an already finished question", async () => {
    const { admin, rpc } = fakeAdmin([{ ...LIVE_ROW, finished_at: "2026-11-04T20:00:25.100Z" }]);
    const { deps, lines } = fakeDeps();
    await expect(closeQuestionIfDue(admin, request(), deps)).resolves.toBe("already-finished");
    expect(rpc).not.toHaveBeenCalled();
    expect(deps.broadcastResolve).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("on a win sends one resolve, one salvo and one close line", async () => {
    const { admin, rpc } = fakeAdmin();
    const { deps, lines } = fakeDeps();
    const close = request();
    await expect(closeQuestionIfDue(admin, close, deps)).resolves.toBe("closed");

    expect(rpc).toHaveBeenCalledWith("resolve_question_once", { p_question_id: close.questionId });
    expect(deps.broadcastResolve).toHaveBeenCalledTimes(1);
    expect(deps.broadcastResolve).toHaveBeenCalledWith("ABCDEF", {
      questionId: close.questionId,
      correctIndex: 2,
      refetch: true,
      serverNow: new Date(DUE_MS).toISOString(),
    });
    expect(deps.broadcastSalvo).toHaveBeenCalledTimes(1);
    expect(deps.broadcastSalvo).toHaveBeenCalledWith("ABCDEF", close.questionId);
    expect(lines).toEqual([{
      kind: "close",
      questionId: close.questionId,
      roomCode: "ABCDEF",
      closedBy: "snapshot-tick",
      lateMs: CLOSE_DUE_AFTER_MS,
    }]);
  });

  it("sends nothing when another caller won", async () => {
    const { admin } = fakeAdmin([LIVE_ROW], [{ data: false, error: null }]);
    const { deps, lines } = fakeDeps();
    await expect(closeQuestionIfDue(admin, request(), deps)).resolves.toBe("lost-race");
    expect(deps.broadcastResolve).not.toHaveBeenCalled();
    expect(deps.broadcastSalvo).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it("treats a raised P0001 as a clean stop with no retry", async () => {
    const { admin, rpc } = fakeAdmin([LIVE_ROW], [{ data: null, error: { code: "P0001" } }]);
    const { deps } = fakeDeps();
    await expect(closeQuestionIfDue(admin, request(), deps)).resolves.toBe("refused");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it("on another error waits 500ms, reads again and retries once", async () => {
    const { admin, read, rpc } = fakeAdmin([LIVE_ROW], [{ data: null, error: { code: "57014" } }, WON]);
    const { deps } = fakeDeps();
    await expect(closeQuestionIfDue(admin, request(), deps)).resolves.toBe("closed");
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(deps.sleep).toHaveBeenCalledWith(500);
    expect(read).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(deps.broadcastResolve).toHaveBeenCalledTimes(1);
  });

  it("gives up after the one retry, and says nothing to the room", async () => {
    const { admin, rpc } = fakeAdmin([LIVE_ROW], [{ data: null, error: { code: "57014" } }]);
    const { deps } = fakeDeps();
    await expect(closeQuestionIfDue(admin, request(), deps)).resolves.toBe("error");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(deps.broadcastResolve).not.toHaveBeenCalled();
  });

  it("does not retry when the re-read shows someone else finished it", async () => {
    const { admin, rpc } = fakeAdmin(
      [LIVE_ROW, { ...LIVE_ROW, finished_at: "2026-11-04T20:00:26.300Z" }],
      [{ data: null, error: { code: "57014" } }],
    );
    const { deps } = fakeDeps();
    await expect(closeQuestionIfDue(admin, request(), deps)).resolves.toBe("already-finished");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(deps.broadcastResolve).not.toHaveBeenCalled();
  });

  it("a failed salvo keeps the close and the log line, and never re-sends resolve", async () => {
    const { admin } = fakeAdmin();
    const { deps, lines } = fakeDeps();
    deps.broadcastSalvo.mockRejectedValueOnce(new Error("socket"));
    await expect(closeQuestionIfDue(admin, request(), deps)).resolves.toBe("closed");
    expect(deps.broadcastResolve).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
  });

  it("shadow logs would-have-closed and changes nothing", async () => {
    vi.stubEnv("LIVE_CLOSE_MODE", "shadow");
    const { admin, rpc } = fakeAdmin();
    const { deps, lines } = fakeDeps();
    const close = request();
    await expect(closeQuestionIfDue(admin, close, deps)).resolves.toBe("shadow");
    expect(rpc).not.toHaveBeenCalled();
    expect(deps.broadcastResolve).not.toHaveBeenCalled();
    expect(deps.broadcastSalvo).not.toHaveBeenCalled();
    expect(lines).toEqual([{
      kind: "close_shadow",
      questionId: close.questionId,
      roomCode: "ABCDEF",
      source: "snapshot-tick",
      lateMs: CLOSE_DUE_AFTER_MS,
    }]);
  });

  it("off reads nothing", async () => {
    vi.stubEnv("LIVE_CLOSE_MODE", "off");
    const { admin, read } = fakeAdmin();
    await expect(closeQuestionIfDue(admin, request(), fakeDeps().deps)).resolves.toBe("off");
    expect(read).not.toHaveBeenCalled();
  });
});

describe("switches", () => {
  it("anything but on or shadow is off", () => {
    for (const [value, mode] of [["on", "on"], ["shadow", "shadow"], ["off", "off"], ["ON", "off"], ["", "off"]]) {
      vi.stubEnv("LIVE_CLOSE_MODE", value);
      expect(liveCloseMode()).toBe(mode);
    }
    vi.stubEnv("LIVE_CLOSE_MODE", undefined as unknown as string);
    expect(liveCloseMode()).toBe("off");
  });

  it("a blank allow-list filters nothing and a set one lets only its nights through", () => {
    expect(liveCloseNightAllowed("night-a")).toBe(true);
    vi.stubEnv("LIVE_CLOSE_NIGHTS", "night-a, night-b");
    expect(liveCloseNightAllowed("night-b")).toBe(true);
    expect(liveCloseNightAllowed("night-c")).toBe(false);
  });
});

describe("tickCloseIfDue", () => {
  const tick = () => ({ ...request(), nightId: "night-a" });

  it("touches nothing when off or when the night isn't listed", async () => {
    const { admin, read } = fakeAdmin();
    vi.stubEnv("LIVE_CLOSE_NIGHTS", "night-b");
    await expect(tickCloseIfDue(admin, tick(), fakeDeps().deps)).resolves.toBe("off");
    vi.stubEnv("LIVE_CLOSE_NIGHTS", "");
    vi.stubEnv("LIVE_CLOSE_MODE", "off");
    await expect(tickCloseIfDue(admin, tick(), fakeDeps().deps)).resolves.toBe("off");
    expect(read).not.toHaveBeenCalled();
  });

  it("skips the read before it's overdue, without spending the question's attempt", async () => {
    const { admin, read } = fakeAdmin();
    const sameTick = tick();
    await expect(tickCloseIfDue(admin, sameTick, fakeDeps(DUE_MS - 1).deps)).resolves.toBe("not-overdue");
    expect(read).not.toHaveBeenCalled();
    await expect(tickCloseIfDue(admin, sameTick, fakeDeps(DUE_MS).deps)).resolves.toBe("closed");
  });

  it("allows one attempt per question per 500ms", async () => {
    const { admin, read } = fakeAdmin([LIVE_ROW], [{ data: false, error: null }]);
    const sameTick = tick();
    await expect(tickCloseIfDue(admin, sameTick, fakeDeps(DUE_MS).deps)).resolves.toBe("lost-race");
    await expect(tickCloseIfDue(admin, sameTick, fakeDeps(DUE_MS + 499).deps)).resolves.toBe("throttled");
    expect(read).toHaveBeenCalledTimes(1);
    await expect(tickCloseIfDue(admin, sameTick, fakeDeps(DUE_MS + 500).deps)).resolves.toBe("lost-race");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("frees the snapshot at 1,500ms while the close carries on", async () => {
    vi.useFakeTimers();
    const { deps } = fakeDeps();
    let finishRpc: (reply: RpcReply) => void = () => undefined;
    const admin = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: LIVE_ROW, error: null }) }) }) }),
      rpc: () => new Promise<RpcReply>((done) => { finishRpc = done; }),
    } as unknown as Admin;

    const pending = tickCloseIfDue(admin, tick(), deps);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(deps.broadcastResolve).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("capped");

    finishRpc(WON);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.broadcastResolve).toHaveBeenCalledTimes(1);
  });

  it("never throws into the snapshot", async () => {
    const admin = {
      from: () => { throw new Error("no client"); },
    } as unknown as Admin;
    await expect(tickCloseIfDue(admin, tick(), fakeDeps().deps)).resolves.toBe("error");
  });
});
