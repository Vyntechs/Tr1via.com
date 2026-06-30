import { afterEach, describe, expect, it, vi } from "vitest";

import { broadcastRoomMagicReaction } from "@/lib/api/broadcast";

const ORIGINAL_ENV = { ...process.env };

describe("broadcastRoomMagicReaction", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it("posts a cosmetic room-magic-reaction event to the room channel", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn(),
    });
    vi.stubGlobal("fetch", fetchMock);

    await broadcastRoomMagicReaction("DEMO42", {
      kind: "wow",
      questionId: "question-1",
      playerId: "player-1",
      serverNow: "2026-06-30T12:00:00.000Z",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/realtime/v1/api/broadcast",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          messages: [
            {
              topic: "room:DEMO42",
              event: "room-magic-reaction",
              payload: {
                kind: "wow",
                questionId: "question-1",
                playerId: "player-1",
                serverNow: "2026-06-30T12:00:00.000Z",
              },
            },
          ],
        }),
      }),
    );
  });
});
