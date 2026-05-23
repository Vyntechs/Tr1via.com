// Route handler test — POST /api/nights/[id]/players.
//
// Host adds a latecomer to an open night. The route mints a fresh
// device_id (uuid) for them, inserts a players row, and auto-opts them
// into the live (or ready) game. Host-only — auth via requireOwnedNight.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({
  getSupabaseAdmin: vi.fn(),
}));
const authMock = vi.hoisted(() => ({
  requireOwnedNight: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const HOST_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeRequest(body: unknown) {
  return new NextRequest(`http://test/api/nights/${NIGHT_ID}/players`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeCtx(nightId = NIGHT_ID) {
  return { params: Promise.resolve({ id: nightId }) };
}

interface GameRow {
  id: string;
  game_no: number;
  state: "draft" | "ready" | "live" | "done";
}

interface FakeOpts {
  night: { id: string; closed_at: string | null };
  games: GameRow[];
  insertedPlayer?: { id: string; night_id: string; device_id: string; display_name: string };
  insertError?: { message: string; code?: string } | null;
}

function makeAdmin(opts: FakeOpts) {
  const participationsInsert = vi.fn();
  const playersInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({
        data: opts.insertedPlayer ?? null,
        error: opts.insertError ?? null,
      })),
    })),
  }));
  return {
    from: vi.fn((table: string) => {
      if (table === "nights") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: opts.night,
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "games") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({
                data: opts.games,
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "players") {
        return { insert: playersInsert };
      }
      if (table === "game_participations") {
        return {
          insert: (participationsInsert as unknown as (...args: unknown[]) => {
            select: () => { maybeSingle: () => Promise<unknown> };
          }).bind(null),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    __playersInsert: playersInsert,
    __participationsInsert: participationsInsert,
  } as unknown as ReturnType<typeof vi.fn> & {
    __playersInsert: ReturnType<typeof vi.fn>;
    __participationsInsert: ReturnType<typeof vi.fn>;
  };
}

function makeAdminWithCapture(opts: FakeOpts) {
  const participationInserts: unknown[] = [];
  const playersInserts: unknown[] = [];

  const playersInsertFn = vi.fn((row: unknown) => {
    playersInserts.push(row);
    return {
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data:
            opts.insertedPlayer ??
            ({
              id: "new-player-id",
              night_id: NIGHT_ID,
              device_id: (row as { device_id?: string }).device_id ?? "dev",
              display_name: (row as { display_name?: string }).display_name ?? "x",
            }),
          error: opts.insertError ?? null,
        })),
      })),
    };
  });

  const participationInsertFn = vi.fn((row: unknown) => {
    participationInserts.push(row);
    return Promise.resolve({ error: null });
  });

  const client = {
    from: vi.fn((table: string) => {
      if (table === "nights") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: opts.night, error: null })),
            })),
          })),
        };
      }
      if (table === "games") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({ data: opts.games, error: null })),
            })),
          })),
        };
      }
      if (table === "players") {
        return { insert: playersInsertFn };
      }
      if (table === "game_participations") {
        return { insert: participationInsertFn };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };

  return { client, playersInserts, participationInserts };
}

describe("POST /api/nights/[id]/players (host adds latecomer)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 when host is not signed in", async () => {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: false,
      status: 401,
      error: "not signed in",
    });
    const { POST } = await import("@/app/api/nights/[id]/players/route");
    const res = await POST(makeRequest({ displayName: "Riley" }), makeCtx());
    expect(res.status).toBe(401);
  });

  it("403 when the host does not own the night", async () => {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: false,
      status: 403,
      error: "not your night",
    });
    const { POST } = await import("@/app/api/nights/[id]/players/route");
    const res = await POST(makeRequest({ displayName: "Riley" }), makeCtx());
    expect(res.status).toBe(403);
  });

  it("400 on invalid body (no displayName)", async () => {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: HOST_ID },
      night: { id: NIGHT_ID, host_id: HOST_ID, closed_at: null },
    });
    const { client } = makeAdminWithCapture({
      night: { id: NIGHT_ID, closed_at: null },
      games: [{ id: "g1", game_no: 1, state: "live" }],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { POST } = await import("@/app/api/nights/[id]/players/route");
    const res = await POST(makeRequest({}), makeCtx());
    expect(res.status).toBe(400);
  });

  it("403 when the night is closed", async () => {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: HOST_ID },
      night: {
        id: NIGHT_ID,
        host_id: HOST_ID,
        closed_at: new Date().toISOString(),
      },
    });
    const { client } = makeAdminWithCapture({
      night: { id: NIGHT_ID, closed_at: new Date().toISOString() },
      games: [],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { POST } = await import("@/app/api/nights/[id]/players/route");
    const res = await POST(makeRequest({ displayName: "Riley" }), makeCtx());
    expect(res.status).toBe(403);
  });

  it("creates the player with a fresh device_id and returns the row", async () => {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: HOST_ID },
      night: { id: NIGHT_ID, host_id: HOST_ID, closed_at: null },
    });
    const { client, playersInserts } = makeAdminWithCapture({
      night: { id: NIGHT_ID, closed_at: null },
      games: [
        { id: "g1", game_no: 1, state: "done" },
        { id: "g2", game_no: 2, state: "live" },
      ],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { POST } = await import("@/app/api/nights/[id]/players/route");
    const res = await POST(makeRequest({ displayName: "Riley" }), makeCtx());
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.player).toBeDefined();
    expect(playersInserts).toHaveLength(1);
    const inserted = playersInserts[0] as {
      night_id: string;
      display_name: string;
      device_id: string;
    };
    expect(inserted.night_id).toBe(NIGHT_ID);
    expect(inserted.display_name).toBe("Riley");
    // device_id must be a UUID v4 shape, freshly minted by the server.
    expect(inserted.device_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("auto-opts the latecomer into the current live game", async () => {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: HOST_ID },
      night: { id: NIGHT_ID, host_id: HOST_ID, closed_at: null },
    });
    const { client, participationInserts } = makeAdminWithCapture({
      night: { id: NIGHT_ID, closed_at: null },
      games: [
        { id: "g1", game_no: 1, state: "done" },
        { id: "g2", game_no: 2, state: "live" },
      ],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { POST } = await import("@/app/api/nights/[id]/players/route");
    const res = await POST(makeRequest({ displayName: "Riley" }), makeCtx());
    expect(res.status).toBe(201);
    expect(participationInserts).toHaveLength(1);
    const part = participationInserts[0] as { game_id: string };
    expect(part.game_id).toBe("g2");
  });

  it("does not auto-opt into a 'done' game when no live/ready game exists", async () => {
    authMock.requireOwnedNight.mockResolvedValue({
      ok: true,
      host: { id: HOST_ID },
      night: { id: NIGHT_ID, host_id: HOST_ID, closed_at: null },
    });
    const { client, participationInserts } = makeAdminWithCapture({
      night: { id: NIGHT_ID, closed_at: null },
      games: [
        { id: "g1", game_no: 1, state: "done" },
        { id: "g2", game_no: 2, state: "done" },
      ],
    });
    adminMock.getSupabaseAdmin.mockReturnValue(client);

    const { POST } = await import("@/app/api/nights/[id]/players/route");
    const res = await POST(makeRequest({ displayName: "Riley" }), makeCtx());
    expect(res.status).toBe(201);
    expect(participationInserts).toHaveLength(0);
  });
});
