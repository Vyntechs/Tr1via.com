// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const broadcast = vi.hoisted(() => ({
  broadcastToRoom: vi.fn(),
  broadcastFireworks: vi.fn(),
}));
vi.mock("@/lib/api/broadcast", () => broadcast);
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: vi.fn() }));
const nextServer = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock("next/server", () => nextServer);

import {
  __resetCloseOutboxForTests,
  DRAIN_DEADLINE_MS,
  DRAIN_MIN_GAP_MS,
  drainCloseOutbox,
  scheduleCloseDrain,
} from "@/lib/api/closeOutbox";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Admin = Parameters<typeof drainCloseOutbox>[0];

const row = (over: Record<string, unknown> = {}) => ({
  id: 7,
  question_id: "q1",
  night_id: "n1",
  room_code: "ROOM42",
  correct_index: 2,
  played_at: "2026-11-04T12:00:00.000Z",
  shadow: false,
  closed_at: "2026-11-04T12:00:26.000Z",
  commit_at: "2026-11-04T12:00:26.010Z",
  claimed_at: "2026-11-04T12:00:27.000Z",
  claim_count: 1,
  sent_at: null,
  sent_via: null,
  dropped_at: null,
  drop_reason: null,
  ...over,
});

type WriteResult = { error: unknown };

function fakeAdmin(
  claims: unknown[][],
  claimError: unknown = null,
  write: () => Promise<WriteResult> = async () => ({ error: null }),
) {
  const stamps: { id: unknown; values: Record<string, unknown>; signal: unknown }[] = [];
  const order: string[] = [];
  let call = 0;
  const rpc = vi.fn(() => ({
    abortSignal: async () => ({
      data: claimError ? null : (claims[call++] ?? []),
      error: claimError,
    }),
  }));
  const from = vi.fn(() => ({
    update: (values: Record<string, unknown>) => ({
      eq: (_column: string, id: unknown) => ({
        abortSignal: (signal: unknown) => {
          order.push("stamp");
          stamps.push({ id, values, signal });
          return write();
        },
      }),
    }),
  }));
  return { admin: { rpc, from } as unknown as Admin, rpc, stamps, order };
}

const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
const fetchFailed = (code: string) =>
  new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
const neverSettles = () => new Promise<never>(() => {});
const RELEASE = { sent_at: null, sent_via: null };

describe("drainCloseOutbox", () => {
  beforeEach(() => {
    __resetCloseOutboxForTests();
    vi.useRealTimers();
    broadcast.broadcastToRoom.mockReset().mockResolvedValue(undefined);
    broadcast.broadcastFireworks.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("sends nothing when the claim hands back nothing", async () => {
    const { admin, stamps } = fakeAdmin([[]]);
    await drainCloseOutbox(admin);
    expect(broadcast.broadcastToRoom).not.toHaveBeenCalled();
    expect(broadcast.broadcastFireworks).not.toHaveBeenCalled();
    expect(stamps).toEqual([]);
  });

  it("sends one resolve, one fireworks, then labels the row", async () => {
    const { admin, stamps, order } = fakeAdmin([[row()]]);
    broadcast.broadcastToRoom.mockImplementation(async () => void order.push("resolve"));
    broadcast.broadcastFireworks.mockImplementation(async () => void order.push("fireworks"));

    await drainCloseOutbox(admin);

    expect(broadcast.broadcastToRoom).toHaveBeenCalledTimes(1);
    expect(broadcast.broadcastToRoom).toHaveBeenCalledWith(
      "ROOM42",
      "resolve",
      expect.objectContaining({ questionId: "q1", correctIndex: 2, refetch: true }),
    );
    expect(broadcast.broadcastFireworks).toHaveBeenCalledTimes(1);
    expect(broadcast.broadcastFireworks).toHaveBeenCalledWith("ROOM42", "salvo", "q1");
    expect(order).toEqual(["resolve", "fireworks", "stamp"]);
    expect(stamps[0].id).toBe(7);
    expect(stamps[0].values).toEqual({ sent_via: "rest" });
    expect(stamps[0].signal).toBeInstanceOf(AbortSignal);
  });

  it("treats a timed-out send as possibly delivered and doesn't release it", async () => {
    const { admin, stamps } = fakeAdmin([[row()], []]);
    broadcast.broadcastToRoom.mockRejectedValueOnce(abortError());

    await drainCloseOutbox(admin);
    await drainCloseOutbox(admin, { urgent: true });

    expect(broadcast.broadcastToRoom).toHaveBeenCalledTimes(1);
    expect(stamps.map((s) => s.values)).toEqual([{ sent_via: "rest-timeout" }]);
    expect(broadcast.broadcastFireworks).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a gateway 504", new Error("broadcast HTTP 504: gateway"), "rest-http_5xx"],
    ["a 503", new Error("broadcast HTTP 503: down"), "rest-http_5xx"],
    ["a reset after the post went out", fetchFailed("ECONNRESET"), "rest-network"],
    ["a fetch failure with no reason", new TypeError("fetch failed"), "rest-network"],
  ])("keeps the row sent after %s, which may have arrived", async (_name, error, via) => {
    const { admin, stamps } = fakeAdmin([[row()]]);
    broadcast.broadcastToRoom.mockRejectedValueOnce(error);

    await drainCloseOutbox(admin);

    expect(stamps.map((s) => s.values)).toEqual([{ sent_via: via }]);
    expect(broadcast.broadcastFireworks).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a 401", new Error("broadcast HTTP 401: nope")],
    ["missing keys", new Error("broadcastToRoom: missing NEXT_PUBLIC_SUPABASE_URL")],
    ["a refused connection", fetchFailed("ECONNREFUSED")],
    ["an unknown host", fetchFailed("ENOTFOUND")],
  ])("releases the row after %s, with no fireworks", async (_name, error) => {
    const { admin, stamps } = fakeAdmin([[row()]]);
    broadcast.broadcastToRoom.mockRejectedValueOnce(error);

    await drainCloseOutbox(admin);

    expect(stamps.map((s) => s.values)).toEqual([RELEASE]);
    expect(stamps[0].signal).toBeInstanceOf(AbortSignal);
    expect(broadcast.broadcastFireworks).not.toHaveBeenCalled();
  });

  it("a failed release leaves the row sent and never throws", async () => {
    const { admin } = fakeAdmin([[row()]], null, async () => ({ error: { code: "57014" } }));
    broadcast.broadcastToRoom.mockRejectedValueOnce(new Error("broadcast HTTP 401: nope"));

    await expect(drainCloseOutbox(admin)).resolves.toBeUndefined();

    expect(broadcast.broadcastFireworks).not.toHaveBeenCalled();
  });

  it.each([
    ["errors", async () => ({ error: { code: "57014" } })],
    ["throws", () => Promise.reject(new Error("socket hang up"))],
  ])("a label write that %s changes nothing: one resolve, one fireworks", async (_name, write) => {
    const { admin, stamps } = fakeAdmin([[row()], []], null, write);

    await expect(drainCloseOutbox(admin)).resolves.toBeUndefined();
    await drainCloseOutbox(admin, { urgent: true });

    expect(stamps).toHaveLength(1);
    expect(broadcast.broadcastToRoom).toHaveBeenCalledTimes(1);
    expect(broadcast.broadcastFireworks).toHaveBeenCalledTimes(1);
  });

  it("a failed fireworks send doesn't undo the label or retry", async () => {
    const { admin, stamps } = fakeAdmin([[row()]]);
    broadcast.broadcastFireworks.mockRejectedValueOnce(new Error("broadcast HTTP 500: x"));

    await expect(drainCloseOutbox(admin)).resolves.toBeUndefined();

    expect(stamps).toHaveLength(1);
    expect(broadcast.broadcastFireworks).toHaveBeenCalledTimes(1);
  });

  it("a hung label write can't stop later drains: the deadline lets go of it", async () => {
    vi.useFakeTimers();
    const { admin, rpc } = fakeAdmin([[row()], [row({ id: 8, question_id: "q2" })]], null, neverSettles);

    const stuck = drainCloseOutbox(admin);
    await vi.advanceTimersByTimeAsync(DRAIN_DEADLINE_MS - 1);
    const joined = drainCloseOutbox(admin, { urgent: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(broadcast.broadcastFireworks).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(Promise.all([stuck, joined])).resolves.toBeDefined();

    const next = drainCloseOutbox(admin, { urgent: true });
    await vi.advanceTimersByTimeAsync(DRAIN_DEADLINE_MS);
    await next;
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(broadcast.broadcastToRoom).toHaveBeenCalledTimes(2);
  });

  it("a send that never settles can't stop later drains either", async () => {
    vi.useFakeTimers();
    const { admin, rpc } = fakeAdmin([[row()], []]);
    broadcast.broadcastToRoom.mockImplementationOnce(neverSettles);

    const stuck = drainCloseOutbox(admin);
    await vi.advanceTimersByTimeAsync(DRAIN_DEADLINE_MS);
    await stuck;

    await drainCloseOutbox(admin, { urgent: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("a finished drain leaves no deadline timer behind", async () => {
    vi.useFakeTimers();
    const { admin } = fakeAdmin([[row()]]);

    await drainCloseOutbox(admin);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("claims at most once a second per instance", async () => {
    vi.useFakeTimers();
    const { admin, rpc } = fakeAdmin([[], [], []]);

    await drainCloseOutbox(admin);
    await drainCloseOutbox(admin);
    expect(rpc).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(DRAIN_MIN_GAP_MS);
    await drainCloseOutbox(admin);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("urgent skips the wait but joins a drain already running", async () => {
    const { admin, rpc } = fakeAdmin([[], []]);

    const first = drainCloseOutbox(admin);
    const joined = drainCloseOutbox(admin, { urgent: true });
    await Promise.all([first, joined]);
    expect(rpc).toHaveBeenCalledTimes(1);

    await drainCloseOutbox(admin, { urgent: true });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("never throws when the claim fails", async () => {
    const { admin } = fakeAdmin([], { code: "PGRST202" });
    await expect(drainCloseOutbox(admin)).resolves.toBeUndefined();
    expect(broadcast.broadcastToRoom).not.toHaveBeenCalled();
  });

  it("scheduleCloseDrain does nothing outside a request", () => {
    nextServer.after.mockImplementationOnce(() => {
      throw new Error("after was called outside a request scope");
    });
    expect(() => scheduleCloseDrain()).not.toThrow();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it("scheduleCloseDrain drains after the response inside a request", async () => {
    const { admin, rpc } = fakeAdmin([[row()]]);
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin);
    let task: (() => Promise<void>) | undefined;
    nextServer.after.mockImplementationOnce((fn: () => Promise<void>) => {
      task = fn;
    });

    scheduleCloseDrain();
    expect(rpc).not.toHaveBeenCalled();
    await task?.();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(broadcast.broadcastToRoom).toHaveBeenCalledTimes(1);
  });
});
