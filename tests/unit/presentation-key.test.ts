import { describe, expect, it } from "vitest";
import { presentationKey } from "@/lib/room/presentationKey";

describe("presentationKey", () => {
  it("is stable, non-revealing, and separated by audience", () => {
    const secret = "test-secret";
    const nightId = "11111111-1111-4111-8111-111111111111";
    const playerId = "22222222-2222-4222-8222-222222222222";

    const playerKey = presentationKey(secret, "player", "player", nightId, playerId);
    const tvKey = presentationKey(secret, "tv", "player", nightId, playerId);

    expect(playerKey).toBe(presentationKey(secret, "player", "player", nightId, playerId));
    expect(playerKey).not.toBe(tvKey);
    expect(playerKey).not.toContain(playerId);
    expect(tvKey).not.toContain(playerId);
  });
});
