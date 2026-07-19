import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ requireOwnedNight: vi.fn() }));
const projectMock = vi.hoisted(() => ({ projectExactLiveEvent: vi.fn() }));
const broadcastMock = vi.hoisted(() => ({
  broadcastAppliedLiveRoomEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/live-answer/projectEvent", () => projectMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const RUN_ID = "22222222-2222-2222-2222-222222222222";
const OPENED_AT = "2026-07-19T14:00:00.000Z";

function request() {
  return new NextRequest(`http://test/api/nights/${NIGHT_ID}/open`, {
    method: "POST",
  });
}

function context() {
  return { params: Promise.resolve({ id: NIGHT_ID }) };
}

function adminWith(
  data: unknown,
  durable: {
    opened_at: string;
    answer_engine: string;
    current_run_id: string | null;
    room_revision: number;
    control_revision: number;
  } = {
    opened_at: OPENED_AT,
    answer_engine: "legacy",
    current_run_id: null,
    room_revision: 0,
    control_revision: 0,
  },
) {
  const update = vi.fn(() => {
    throw new Error("route must not pre-update the night");
  });
  const maybeSingle = vi.fn().mockResolvedValue({ data: durable, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return {
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
    from: vi.fn(() => ({ select, update })),
    update,
  };
}

const resilientResult = {
  code: "applied",
  applied: true,
  eventKind: "night_opened",
  runId: RUN_ID,
  roomRevision: 1,
  controlRevision: 1,
};

describe("POST /api/nights/[id]/open", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: "host" },
      night: {
        id: NIGHT_ID,
        room_code: "ABCDEF",
        opened_at: null,
        current_run_id: null,
        control_revision: 0,
      },
    });
    projectMock.projectExactLiveEvent.mockResolvedValue({
      runId: RUN_ID,
      roomRevision: 1,
      controlRevision: 1,
      playId: null,
      play: null,
    });
    broadcastMock.broadcastAppliedLiveRoomEvent.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the atomic RPC and maps a strict legacy result to the existing response", async () => {
    const admin = adminWith({
      freshlyApplied: false,
      result: { code: "legacy_opened", openedAt: OPENED_AT },
    });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/nights/[id]/open/route");
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ openedAt: OPENED_AT });
    expect(admin.rpc).toHaveBeenCalledWith("open_night_run", {
      p_night_id: NIGHT_ID,
      p_command_id: expect.any(String),
      p_expected_run_id: null,
      p_expected_control_revision: 0,
    });
    expect(admin.update).not.toHaveBeenCalled();
    expect(projectMock.projectExactLiveEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("projects and broadcasts only a strict fresh resilient winner", async () => {
    const admin = adminWith(
      { freshlyApplied: true, result: resilientResult },
      {
        opened_at: OPENED_AT,
        answer_engine: "resilient_v1",
        current_run_id: RUN_ID,
        room_revision: 1,
        control_revision: 1,
      },
    );
    adminMock.getSupabaseAdmin.mockReturnValue(admin);

    const { POST } = await import("@/app/api/nights/[id]/open/route");
    const response = await POST(request(), context());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ openedAt: OPENED_AT });
    expect(projectMock.projectExactLiveEvent).toHaveBeenCalledWith(NIGHT_ID, {
      applied: true,
      freshness: "transaction_winner",
      kind: "night_opened",
      runId: RUN_ID,
      gameId: null,
      questionId: null,
      roomRevision: 1,
      controlRevision: 1,
      playId: null,
      previousRunId: null,
    });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).toHaveBeenCalledTimes(1);
  });

  it("does not project or broadcast an exact resilient replay", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(adminWith({
      freshlyApplied: false,
      result: resilientResult,
    }, {
      opened_at: OPENED_AT,
      answer_engine: "resilient_v1",
      current_run_id: RUN_ID,
      room_revision: 1,
      control_revision: 1,
    }));

    const { POST } = await import("@/app/api/nights/[id]/open/route");
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(projectMock.projectExactLiveEvent).not.toHaveBeenCalled();
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed RPC envelope without leaking it", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(adminWith({
      freshlyApplied: true,
      result: { ...resilientResult, playerId: "private" },
    }));

    const { POST } = await import("@/app/api/nights/[id]/open/route");
    const response = await POST(request(), context());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "could not open night" });
    expect(broadcastMock.broadcastAppliedLiveRoomEvent).not.toHaveBeenCalled();
  });

  it("keeps the committed open successful when the fast broadcast fails", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(adminWith(
      { freshlyApplied: true, result: resilientResult },
      {
        opened_at: OPENED_AT,
        answer_engine: "resilient_v1",
        current_run_id: RUN_ID,
        room_revision: 1,
        control_revision: 1,
      },
    ));
    broadcastMock.broadcastAppliedLiveRoomEvent.mockRejectedValueOnce(new Error("offline"));

    const { POST } = await import("@/app/api/nights/[id]/open/route");
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ openedAt: OPENED_AT });
    expect(console.warn).toHaveBeenCalledWith("broadcast night-opened failed");
  });
});
