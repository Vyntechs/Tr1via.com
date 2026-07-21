import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
const authMock = vi.hoisted(() => ({
  getDeviceId: vi.fn(),
}));
const broadcastMock = vi.hoisted(() => ({
  broadcastRoomMagicReaction: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const QUESTION_ID = "11111111-1111-1111-1111-111111111111";
const CATEGORY_ID = "22222222-2222-2222-2222-222222222222";
const GAME_ID = "33333333-3333-3333-3333-333333333333";
const NIGHT_ID = "44444444-4444-4444-4444-444444444444";
const PLAYER_ID = "55555555-5555-5555-5555-555555555555";
const DEVICE_ID = "66666666-6666-6666-6666-666666666666";
const REACTION_ID = "88888888-8888-8888-8888-888888888888";
const REACTION_CREATED_AT = "2026-06-30T12:00:30.000Z";

function makeRequest(body: unknown) {
  return new NextRequest("http://test/api/room-magic/reactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface FakeAdminOptions {
  question?: Record<string, unknown> | null;
  category?: Record<string, unknown> | null;
  game?: Record<string, unknown> | null;
  night?: Record<string, unknown> | null;
  player?: Record<string, unknown> | null;
  participation?: Record<string, unknown> | null;
  reactionData?: { id: string; created_at: string } | null;
  upsertError?: { code?: string; message: string } | null;
}

function query(data: Record<string, unknown> | null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  return builder;
}

function makeAdmin(opts: FakeAdminOptions = {}) {
  const rows = {
    questions:
      opts.question === undefined
        ? {
            id: QUESTION_ID,
            category_id: CATEGORY_ID,
            played_at: "2026-06-30T12:00:00.000Z",
            finished_at: "2026-06-30T12:00:20.000Z",
          }
        : opts.question,
    categories:
      opts.category === undefined
        ? { id: CATEGORY_ID, game_id: GAME_ID }
        : opts.category,
    games:
      opts.game === undefined
        ? { id: GAME_ID, night_id: NIGHT_ID }
        : opts.game,
    nights:
      opts.night === undefined
        ? { id: NIGHT_ID, room_code: "DEMO42", room_magic_enabled: true }
        : opts.night,
    players:
      opts.player === undefined
        ? { id: PLAYER_ID, removed_at: null }
        : opts.player,
    game_participations:
      opts.participation === undefined
        ? { id: "77777777-7777-7777-7777-777777777777" }
        : opts.participation,
  };

  const reactionWrites: unknown[] = [];
  const reactionData =
    opts.reactionData === undefined
      ? { id: REACTION_ID, created_at: REACTION_CREATED_AT }
      : opts.reactionData;
  const reactionResult = () => ({
    data: opts.upsertError ? null : reactionData,
    error: opts.upsertError ?? null,
  });
  const upsertReaction = vi.fn((row: unknown, options: unknown) => {
    void options;
    reactionWrites.push(row);
    const builder = {
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => reactionResult()),
    };
    return builder;
  });

  const client = {
    from: vi.fn((table: string) => {
      if (table === "room_magic_reactions") {
        return { upsert: upsertReaction };
      }
      if (table in rows) {
        return query(rows[table as keyof typeof rows]);
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };

  return { client, reactionWrites, upsertReaction };
}

async function callRoute(body: unknown) {
  const { POST } = await import("@/app/api/room-magic/reactions/route");
  return POST(makeRequest(body));
}

describe("POST /api/room-magic/reactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T12:00:30.000Z"));
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
    broadcastMock.broadcastRoomMagicReaction.mockResolvedValue(undefined);
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin().client);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns 400 for an unknown reaction kind", async () => {
    const res = await callRoute({ questionId: QUESTION_ID, kind: "chat" });
    expect(res.status).toBe(400);
  });

  it("returns 403 when Room Magic is disabled for the night", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(
      makeAdmin({
        night: { id: NIGHT_ID, room_code: "DEMO42", room_magic_enabled: false },
      }).client,
    );

    const res = await callRoute({ questionId: QUESTION_ID, kind: "wow" });
    expect(res.status).toBe(403);
  });

  it("returns 403 when the device has not joined the question night", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(
      makeAdmin({ player: null }).client,
    );

    const res = await callRoute({ questionId: QUESTION_ID, kind: "wow" });
    expect(res.status).toBe(403);
  });

  it("returns 409 when the question is not resolved", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(
      makeAdmin({
        question: {
          id: QUESTION_ID,
          category_id: CATEGORY_ID,
          played_at: "2026-06-30T12:00:00.000Z",
          finished_at: null,
        },
      }).client,
    );

    const res = await callRoute({ questionId: QUESTION_ID, kind: "wow" });
    expect(res.status).toBe(409);
  });

  it("accepts and broadcasts a valid first reaction", async () => {
    const admin = makeAdmin();
    adminMock.getSupabaseAdmin.mockReturnValue(admin.client);

    const res = await callRoute({ questionId: QUESTION_ID, kind: "wow" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      accepted: true,
      broadcasted: true,
    });
    expect(admin.reactionWrites).toEqual([
      {
        night_id: NIGHT_ID,
        game_id: GAME_ID,
        question_id: QUESTION_ID,
        player_id: PLAYER_ID,
        kind: "wow",
      },
    ]);
    expect(broadcastMock.broadcastRoomMagicReaction).toHaveBeenCalledWith(
      "DEMO42",
      {
        id: REACTION_ID,
        kind: "wow",
        serverNow: REACTION_CREATED_AT,
      },
    );
  });

  it("treats a duplicate reaction as an accepted no-op without a constraint error", async () => {
    const admin = makeAdmin({ reactionData: null });
    adminMock.getSupabaseAdmin.mockReturnValue(admin.client);

    const res = await callRoute({ questionId: QUESTION_ID, kind: "wow" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      accepted: false,
      reason: "already_sent",
    });
    expect(admin.upsertReaction).toHaveBeenCalledWith(
      {
        night_id: NIGHT_ID,
        game_id: GAME_ID,
        question_id: QUESTION_ID,
        player_id: PLAYER_ID,
        kind: "wow",
      },
      { onConflict: "question_id,player_id,moment", ignoreDuplicates: true },
    );
    expect(broadcastMock.broadcastRoomMagicReaction).not.toHaveBeenCalled();
  });

  it("never exposes a room magic database error", async () => {
    const sentinel = "SENTINEL room_magic_reactions private constraint";
    adminMock.getSupabaseAdmin.mockReturnValue(
      makeAdmin({ upsertError: { code: "XX000", message: sentinel } }).client,
    );

    const res = await callRoute({ questionId: QUESTION_ID, kind: "wow" });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "server error" });
    expect(JSON.stringify(body)).not.toContain(sentinel);
  });

  it("keeps gameplay unblocked when broadcast fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    broadcastMock.broadcastRoomMagicReaction.mockRejectedValue(
      new Error("realtime down"),
    );

    const res = await callRoute({ questionId: QUESTION_ID, kind: "wow" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      accepted: true,
      broadcasted: false,
    });
    expect(warn).toHaveBeenCalledWith(
      "broadcast room magic reaction failed",
      expect.any(Error),
    );
  });
});
