import { beforeEach, describe, expect, it, vi } from "vitest";
import { presentationKey } from "@/lib/room/presentationKey";

const adminMock = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => adminMock);
const authMock = vi.hoisted(() => ({ getDeviceId: vi.fn() }));
vi.mock("@/lib/api/auth", () => authMock);

const NIGHT_ID = "11111111-1111-4111-8111-111111111111";
const PLAYER_ID = "22222222-2222-4222-8222-222222222222";
const DEVICE_ID = "33333333-3333-4333-8333-333333333333";
const SECRET = "snapshot-test-secret";

function query(rows: Record<string, unknown>[]) {
  let data = [...rows];
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      if (!column.includes(".")) data = data.filter((row) => row[column] === value);
      return builder;
    },
    not: () => builder,
    is: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve),
  };
  return builder;
}

function admin() {
  return {
    from: vi.fn((table: string) => {
      if (table === "games") return query([{ id: "game-1", night_id: NIGHT_ID }]);
      if (table === "players") {
        return query([{ id: PLAYER_ID, night_id: NIGHT_ID, device_id: DEVICE_ID }]);
      }
      if (table === "questions") return query([{ id: "question-1" }]);
      if (table === "answers") {
        return query([{
          question_id: "question-1",
          player_id: PLAYER_ID,
          ms_to_lock: 1200,
          locked_at: "2026-07-19T00:00:01.200Z",
        }]);
      }
      return query([]);
    }),
  };
}

async function call(audience?: "player" | "tv") {
  const { GET } = await import("@/app/api/games/[id]/locks/route");
  const queryString = audience ? `?audience=${audience}` : "";
  return GET(new Request(`http://test/api/games/game-1/locks${queryString}`), {
    params: Promise.resolve({ id: "game-1" }),
  });
}

describe("GET /api/games/:id/locks presentation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SESSION_SECRET = SECRET;
    authMock.getDeviceId.mockResolvedValue(null);
    adminMock.getSupabaseAdmin.mockReturnValue(admin());
  });

  it("forces anonymous player-audience requests into the public TV namespace", async () => {
    const playerBody = await (await call("player")).json();
    const tvBody = await (await call("tv")).json();

    expect(JSON.stringify(playerBody)).not.toContain(PLAYER_ID);
    expect(JSON.stringify(tvBody)).not.toContain(PLAYER_ID);
    expect(authMock.getDeviceId).toHaveBeenCalledTimes(1);
    expect(playerBody.locks[0].playerId).toBe(tvBody.locks[0].playerId);
    expect(playerBody.locks[0].playerId).toBe(
      presentationKey(SECRET, "tv", "player", NIGHT_ID, PLAYER_ID),
    );
  });

  it("keeps the no-query public fallback TV-scoped", async () => {
    const body = await (await call()).json();

    expect(authMock.getDeviceId).not.toHaveBeenCalled();
    expect(body.locks[0].playerId).toBe(
      presentationKey(SECRET, "tv", "player", NIGHT_ID, PLAYER_ID),
    );
  });

  it("issues player-scoped keys only to a verified device in the game's night", async () => {
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const playerBody = await (await call("player")).json();

    expect(JSON.stringify(playerBody)).not.toContain(PLAYER_ID);
    expect(playerBody.locks[0].playerId).toBe(
      presentationKey(SECRET, "player", "player", NIGHT_ID, PLAYER_ID),
    );
  });

  it("forces a signed device from another night into the public TV namespace", async () => {
    authMock.getDeviceId.mockResolvedValue("device-from-another-night");

    const playerBody = await (await call("player")).json();

    expect(playerBody.locks[0].playerId).toBe(
      presentationKey(SECRET, "tv", "player", NIGHT_ID, PLAYER_ID),
    );
  });

  it("keeps an explicit TV request TV-scoped even when the browser has a signed player", async () => {
    authMock.getDeviceId.mockResolvedValue(DEVICE_ID);

    const body = await (await call("tv")).json();

    expect(authMock.getDeviceId).not.toHaveBeenCalled();
    expect(body.locks[0].playerId).toBe(
      presentationKey(SECRET, "tv", "player", NIGHT_ID, PLAYER_ID),
    );
  });
});
