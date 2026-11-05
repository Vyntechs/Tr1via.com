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

function fakeAdmin(claims: unknown[][], claimError: unknown = null) {
  const stamps: { id: unknown; values: Record<string, unknown> }[] = [];
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
      eq: async (_column: string, id: unknown) => {
        order.push("stamp");
        stamps.push({ id, values });
        return { error: null };
      },
    }),
  }));
  return { admin: { rpc, from } as unknown as Admin, rpc, stamps, order };
}

const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });

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

  it("sends one resolve, stamps it, then one fireworks for a claimed close", async () => {
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
    expect(order).toEqual(["resolve", "stamp", "fireworks"]);
    expect(stamps[0].id).toBe(7);
    expect(stamps[0].values.sent_via).toBe("rest");
  });

  it("stamps a timed-out send as possibly delivered and doesn't resend it", async () => {
    const { admin, stamps } = fakeAdmin([[row()], []]);
    broadcast.broadcastToRoom.mockRejectedValueOnce(abortError());

    await drainCloseOutbox(admin);
    await drainCloseOutbox(admin, { urgent: true });

    expect(broadcast.broadcastToRoom).toHaveBeenCalledTimes(1);
    expect(stamps).toHaveLength(1);
    expect(stamps[0].values.sent_via).toBe("rest-timeout");
    expect(broadcast.broadcastFireworks).toHaveBeenCalledTimes(1);
  });

  it("leaves a refused send unstamped, with no fireworks, for the next claim", async () => {
    const { admin, stamps } = fakeAdmin([[row()]]);
    broadcast.broadcastToRoom.mockRejectedValueOnce(new Error("broadcast HTTP 503: down"));

    await drainCloseOutbox(admin);

    expect(stamps).toEqual([]);
    expect(broadcast.broadcastFireworks).not.toHaveBeenCalled();
  });

  it("a failed fireworks send doesn't undo the stamp or retry", async () => {
    const { admin, stamps } = fakeAdmin([[row()]]);
    broadcast.broadcastFireworks.mockRejectedValueOnce(new Error("broadcast HTTP 500: x"));

    await expect(drainCloseOutbox(admin)).resolves.toBeUndefined();

    expect(stamps).toHaveLength(1);
    expect(broadcast.broadcastFireworks).toHaveBeenCalledTimes(1);
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
