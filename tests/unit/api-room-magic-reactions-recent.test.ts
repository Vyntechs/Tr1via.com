import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const CODE = "ABCDEF";

function qb(rows: Record<string, unknown>[]) {
  let data = [...rows];
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => {
      data = data.filter((r) => r[c] === v);
      return b;
    },
    gte: () => b,
    order: (c: string, opts?: { ascending?: boolean }) => {
      data = [...data].sort((a, bRow) => {
        const av = String(a[c] ?? "");
        const bv = String(bRow[c] ?? "");
        return opts?.ascending === false ? bv.localeCompare(av) : av.localeCompare(bv);
      });
      return b;
    },
    limit: (n: number) => {
      data = data.slice(0, n);
      return b;
    },
    maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
    then: (onF: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(onF),
  };
  return b;
}

function makeAdmin() {
  const seed: Record<string, Record<string, unknown>[]> = {
    nights: [
      {
        id: NIGHT_ID,
        room_code: CODE,
        room_magic_enabled: true,
      },
    ],
    room_magic_reactions: [
      {
        night_id: NIGHT_ID,
        question_id: "question-1",
        player_id: "player-1",
        kind: "wow",
        created_at: "2026-07-02T01:54:31.000Z",
      },
      {
        night_id: NIGHT_ID,
        question_id: "question-1",
        player_id: "player-2",
        kind: "nice_one",
        created_at: "2026-07-02T01:54:36.000Z",
      },
    ],
  };
  return { from: vi.fn((table: string) => qb(seed[table] ?? [])) };
}

async function callRoute(code = CODE) {
  const { GET } = await import("@/app/api/room-magic/reactions/recent/route");
  return GET(new NextRequest(`http://test/api/room-magic/reactions/recent?code=${code}`));
}

describe("GET /api/room-magic/reactions/recent", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns recent Room Magic reactions as replayable events", async () => {
    adminMock.getSupabaseAdmin.mockReturnValue(makeAdmin());

    const res = await callRoute();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      reactions: [
        {
          kind: "wow",
          questionId: "question-1",
          playerId: "player-1",
          serverNow: "2026-07-02T01:54:31.000Z",
        },
        {
          kind: "nice_one",
          questionId: "question-1",
          playerId: "player-2",
          serverNow: "2026-07-02T01:54:36.000Z",
        },
      ],
    });
  });
});
