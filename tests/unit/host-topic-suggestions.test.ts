import { describe, expect, it } from "vitest";
import { buildTopTopicSuggestions } from "@/lib/host/topicSuggestions";

describe("buildTopTopicSuggestions", () => {
  it("uses only the latest visible suggestion per player", () => {
    const rows = [
      { player_id: "p1", text: "Old idea", created_at: "2026-07-05T00:00:00Z" },
      { player_id: "p1", text: "Pixar Movies", created_at: "2026-07-05T01:00:00Z" },
      { player_id: "p2", text: "pixar movies", created_at: "2026-07-05T01:05:00Z" },
      { player_id: "p3", text: "NFL Teams", created_at: "2026-07-05T01:10:00Z" },
    ];
    expect(buildTopTopicSuggestions(rows)).toEqual([
      { name: "pixar movies", count: 2, latestAt: "2026-07-05T01:05:00Z" },
      { name: "NFL Teams", count: 1, latestAt: "2026-07-05T01:10:00Z" },
    ]);
  });

  it("sorts by count, then latest activity, then name", () => {
    const rows = [
      { player_id: "p1", text: "B", created_at: "2026-07-05T01:00:00Z" },
      { player_id: "p2", text: "A", created_at: "2026-07-05T02:00:00Z" },
      { player_id: "p3", text: "C", created_at: "2026-07-05T03:00:00Z" },
      { player_id: "p4", text: "C", created_at: "2026-07-05T04:00:00Z" },
    ];
    expect(buildTopTopicSuggestions(rows, 2).map((s) => s.name)).toEqual(["C", "A"]);
  });
});
