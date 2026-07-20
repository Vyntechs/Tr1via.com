import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getAuthedHost: vi.fn(),
  getDeviceId: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  getAuthedHost: h.getAuthedHost,
  getDeviceId: h.getDeviceId,
}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: h.getSupabaseAdmin }));

type Row = Record<string, unknown>;

function field(row: Row, column: string) {
  return column.split(".").reduce<unknown>((value, key) =>
    value && typeof value === "object" ? (value as Row)[key] : undefined, row);
}

function query(rows: Row[], error: { message: string } | null = null) {
  let data = [...rows];
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      data = data.filter((row) => field(row, column) === value);
      return builder;
    },
    neq: (column: string, value: unknown) => {
      data = data.filter((row) => field(row, column) !== value);
      return builder;
    },
    is: (column: string, value: unknown) => {
      data = data.filter((row) => (field(row, column) ?? null) === value);
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      data = data.filter((row) => values.includes(field(row, column)));
      return builder;
    },
    order: () => builder,
    limit: (count: number) => {
      data = data.slice(0, count);
      return builder;
    },
    maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error }),
    then: (resolve: (value: { data: Row[]; error: { message: string } | null }) => unknown) =>
      Promise.resolve({ data, error }).then(resolve),
  };
  return builder;
}

function admin(seed: Record<string, Row[]>, options: { cleanupError?: boolean } = {}) {
  return {
    from: vi.fn((table: string) => query(seed[table] ?? [])),
    rpc: vi.fn((name: string) => Promise.resolve({
      data: name === "cleanup_expired_surface_observations" ? 0 : "accepted",
      error: name === "cleanup_expired_surface_observations" && options.cleanupError
        ? { message: "cleanup failed" }
        : null,
    })),
  };
}

const night = {
  id: "night-1",
  host_id: "host-1",
  room_code: "ABC234",
  answer_engine: "resilient_v1",
  current_run_id: "run-1",
  room_revision: 9,
  control_revision: 4,
};

describe("game delivery authority helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SESSION_SECRET", "test-delivery-secret");
    h.getDeviceId.mockResolvedValue("device-1");
    h.getAuthedHost.mockResolvedValue({ ok: true, host: { id: "host-1" } });
  });

  it("authorizes an active player with participation in any game from the night", async () => {
    h.getSupabaseAdmin.mockReturnValue(admin({
      nights: [night],
      players: [{ id: "player-1", night_id: "night-1", device_id: "device-1", can_answer: true, removed_at: null }],
      games: [
        { id: "g1", night_id: "night-1", state: "done" },
        { id: "g2", night_id: "night-1", state: "ready" },
      ],
      game_participations: [{ player_id: "player-1", game_id: "g1" }],
      question_plays: [{ id: "old-play", night_id: "night-1", run_id: "run-1", game_id: "g1", status: "resolved" }],
    }));
    const { resolvePlayerObservationContext } = await import("@/lib/api/gameDelivery");

    const result = await resolvePlayerObservationContext("ABC234");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.canonical.playId).toBeNull();
  });

  it("denies an active player that has never participated in a game", async () => {
    h.getSupabaseAdmin.mockReturnValue(admin({
      nights: [night],
      players: [{ id: "player-1", night_id: "night-1", device_id: "device-1", can_answer: true, removed_at: null }],
      games: [{ id: "g1", night_id: "night-1", state: "ready" }],
      game_participations: [],
    }));
    const { resolvePlayerObservationContext } = await import("@/lib/api/gameDelivery");
    expect(await resolvePlayerObservationContext("ABC234")).toEqual({ ok: false, status: 403 });
  });

  it("uses only the current live game's latest visible play", async () => {
    h.getSupabaseAdmin.mockReturnValue(admin({
      nights: [night],
      games: [
        { id: "g1", night_id: "night-1", state: "done" },
        { id: "g2", night_id: "night-1", state: "live" },
      ],
      question_plays: [
        { id: "old-play", night_id: "night-1", run_id: "run-1", game_id: "g1", status: "resolved" },
        { id: "current-play", night_id: "night-1", run_id: "run-1", game_id: "g2", status: "accepting" },
      ],
    }));
    const { resolveTVObservationContext } = await import("@/lib/api/gameDelivery");
    const result = await resolveTVObservationContext("ABC234");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.canonical.playId).toBe("current-play");
  });

  it("requires TV ownership before issuing a delivery identity", async () => {
    h.getAuthedHost.mockResolvedValue({ ok: true, host: { id: "another-host" } });
    h.getSupabaseAdmin.mockReturnValue(admin({ nights: [night] }));
    const { resolveTVObservationContext } = await import("@/lib/api/gameDelivery");
    expect(await resolveTVObservationContext("ABC234")).toEqual({ ok: false, status: 403 });
  });

  it("counts every active answer-capable night player, including G1-only players", async () => {
    h.getSupabaseAdmin.mockReturnValue(admin({
      nights: [night],
      games: [{ id: "g1", night_id: "night-1", state: "done" }, { id: "g2", night_id: "night-1", state: "ready" }],
      players: [
        { id: "player-1", night_id: "night-1", can_answer: true, removed_at: null },
        { id: "player-2", night_id: "night-1", can_answer: true, removed_at: null },
        { id: "score-only", night_id: "night-1", can_answer: false, removed_at: null },
        { id: "removed", night_id: "night-1", can_answer: true, removed_at: "now" },
      ],
      surface_observations: [],
    }));
    const { readOwnedDeliveryReceipt } = await import("@/lib/api/gameDelivery");
    const result = await readOwnedDeliveryReceipt("ABC234");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.recoveringPhones).toBe(2);
  });

  it("fails closed when private receipt cleanup fails", async () => {
    h.getSupabaseAdmin.mockReturnValue(admin({
      nights: [night], games: [{ id: "g1", night_id: "night-1", state: "ready" }], players: [],
    }, { cleanupError: true }));
    const { readOwnedDeliveryReceipt } = await import("@/lib/api/gameDelivery");
    expect(await readOwnedDeliveryReceipt("ABC234")).toEqual({ ok: false, status: 500 });
  });
});
