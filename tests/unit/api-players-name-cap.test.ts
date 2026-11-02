// Route handler test — POST /api/players name cap.
//
// New players with a name over 16 characters get a clear 400. A same-device
// rejoin carrying an old long name (a phone still on the pre-cap page across
// a mid-night deploy) keeps its seat and the name is shortened to 16.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PLAYER_NAME_TOO_LONG_MESSAGE } from "@/lib/player/nameLimit";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
const authMock = vi.hoisted(() => ({ getDeviceId: vi.fn() }));
const broadcastMock = vi.hoisted(() => ({ broadcastRosterChanged: vi.fn(async () => {}) }));

vi.mock("@/lib/supabase/admin", () => adminMock);
vi.mock("@/lib/api/auth", () => authMock);
vi.mock("@/lib/api/broadcast", () => broadcastMock);

const NIGHT_ID = "11111111-1111-1111-1111-111111111111";
const DEVICE_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function makeRequest(body: unknown) {
  return new NextRequest("http://test/api/players", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Minimal chainable fake of the supabase query builder.
function chain(result: unknown, onUpsert?: (row: Record<string, unknown>) => void) {
  const q: Record<string, unknown> = {};
  const self = () => q;
  q.select = vi.fn(self);
  q.eq = vi.fn(self);
  q.insert = vi.fn(self);
  q.upsert = vi.fn((row: Record<string, unknown>) => {
    onUpsert?.(row);
    return q;
  });
  q.maybeSingle = vi.fn(async () => ({ data: result, error: null }));
  q.single = vi.fn(async () => ({ data: result, error: null }));
  return q;
}

function makeAdmin(existing: { id: string } | null) {
  const upserts: Record<string, unknown>[] = [];
  let playersCalls = 0;
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "nights") {
        return chain({ id: NIGHT_ID, room_code: "ABCD", is_locked: false, closed_at: null });
      }
      if (table === "players") {
        playersCalls += 1;
        if (playersCalls === 1) return chain(existing);
        return chain(null, (r) => upserts.push(r));
      }
      if (table === "games") return chain(null);
      return chain(null);
    }),
  };
  // The upsert's .single() must echo the row that was written.
  const origFrom = admin.from;
  admin.from = vi.fn((table: string) => {
    const q = origFrom(table) as Record<string, unknown>;
    if (table === "players" && playersCalls === 2) {
      q.single = vi.fn(async () => {
        const r = upserts[upserts.length - 1];
        return {
          data: {
            id: "pppppppp-pppp-pppp-pppp-pppppppppppp",
            night_id: NIGHT_ID,
            display_name: r.display_name,
            joined_at: "2026-11-04T00:00:00Z",
            last_seen_at: "2026-11-04T00:00:00Z",
            removed_at: null,
            app_switch_total_seconds: 0,
          },
          error: null,
        };
      });
    }
    return q;
  });
  return { admin, upserts };
}

describe("POST /api/players — 16-character name cap", () => {
  beforeEach(() => {
    vi.resetModules();
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);
  });

  it("new player with 16 characters joins", async () => {
    const { admin, upserts } = makeAdmin(null);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/players/route");
    const res = await POST(makeRequest({ nightId: NIGHT_ID, displayName: "A".repeat(16) }));
    expect(res.status).toBe(201);
    expect(upserts[0].display_name).toBe("A".repeat(16));
  });

  it("new player with 17 characters gets a clear 400", async () => {
    const { admin, upserts } = makeAdmin(null);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/players/route");
    const res = await POST(makeRequest({ nightId: NIGHT_ID, displayName: "A".repeat(17) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(PLAYER_NAME_TOO_LONG_MESSAGE);
    expect(upserts).toHaveLength(0);
  });

  it("same-device rejoin with an old long name keeps its seat, name shortened to 16", async () => {
    const { admin, upserts } = makeAdmin({ id: "pppppppp-pppp-pppp-pppp-pppppppppppp" });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/players/route");
    const longName = "Bartholomew The Magnificent"; // 27 characters, allowed before the cap
    const res = await POST(makeRequest({ nightId: NIGHT_ID, displayName: longName }));
    expect(res.status).toBe(201);
    expect(upserts[0].display_name).toBe("Bartholomew The");
    expect((await res.json()).player.displayName).toBe("Bartholomew The");
  });
  it("same-device rejoin cut right at an emoji keeps the whole emoji", async () => {
    const { admin, upserts } = makeAdmin({ id: "pppppppp-pppp-pppp-pppp-pppppppppppp" });
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/players/route");
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"; // 8 UTF-16 units, 1 character
    const res = await POST(
      makeRequest({ nightId: NIGHT_ID, displayName: "A".repeat(15) + family + "BB" }),
    );
    expect(res.status).toBe(201);
    expect(upserts[0].display_name).toBe("A".repeat(15) + family);
  });

  it("new player with stacked glitch marks joins with the extras stripped", async () => {
    const { admin, upserts } = makeAdmin(null);
    adminMock.getSupabaseAdmin.mockReturnValue(admin);
    const { POST } = await import("@/app/api/players/route");
    const res = await POST(
      makeRequest({ nightId: NIGHT_ID, displayName: "A" + "\u0301".repeat(180) + "bc" }),
    );
    expect(res.status).toBe(201);
    expect(upserts[0].display_name).toBe("A" + "\u0301".repeat(3) + "bc");
  });
});
