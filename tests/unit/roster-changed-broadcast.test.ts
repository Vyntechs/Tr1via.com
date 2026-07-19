import { beforeEach, describe, expect, it, vi } from "vitest";

import { broadcastRosterChanged } from "@/lib/api/broadcast";

const RAW_PLAYER_ID = "22222222-2222-4222-8222-222222222222";

describe("roster changed broadcast boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  });

  it("publishes a refresh/welcome signal without the database player id", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(null, { status: 202 }),
    );

    await broadcastRosterChanged("ABCDEF", {
      displayName: "Blair",
      joinedAt: "2026-07-19T00:00:00.000Z",
      colorKey: 4,
      playerId: RAW_PLAYER_ID,
    } as Parameters<typeof broadcastRosterChanged>[1]);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.messages).toEqual([
      {
        topic: "room:ABCDEF",
        event: "roster-changed",
        payload: {
          joinToken: expect.any(String),
          displayName: "Blair",
          joinedAt: "2026-07-19T00:00:00.000Z",
          colorKey: 4,
          serverNow: expect.any(String),
        },
      },
    ]);
    expect(JSON.stringify(body)).not.toContain(RAW_PLAYER_ID);
    expect(body.messages[0].payload).not.toHaveProperty("playerId");
  });
});
