import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOM_PAGE = readFileSync(
  join(process.cwd(), "app/(player)/room/[code]/page.tsx"),
  "utf8",
);
const RECAP_PAGE = readFileSync(
  join(process.cwd(), "app/(player)/room/[code]/recap/page.tsx"),
  "utf8",
);
const WON_PAGE = readFileSync(
  join(process.cwd(), "app/(player)/room/[code]/won/page.tsx"),
  "utf8",
);

describe("player room signed-snapshot boundary", () => {
  it("uses explicit player snapshots and never identifies self by browser device id", () => {
    for (const source of [ROOM_PAGE, RECAP_PAGE, WON_PAGE]) {
      expect(source).toContain('audience: "player"');
      expect(source).toContain("snapshot.self");
      expect(source).not.toContain("device_id === deviceId");
    }
  });

  it("does not issue direct Supabase reads or raw-table subscriptions from player pages", () => {
    for (const source of [ROOM_PAGE, RECAP_PAGE, WON_PAGE]) {
      expect(source).not.toContain("getSupabaseBrowser");
      expect(source).not.toContain('"postgres_changes"');
      expect(source).not.toContain('from("answers")');
      expect(source).not.toContain('from("game_participations")');
      expect(source).not.toContain('from("game_scores")');
      expect(source).not.toContain('from("questions")');
    }
  });

  it("uses canonical snapshot answers, participations, scores, and questions", () => {
    expect(ROOM_PAGE).toContain("snapshot.myAnswers");
    expect(ROOM_PAGE).toContain("snapshot.myParticipations");
    expect(ROOM_PAGE).toContain("snapshot.scores");
    expect(ROOM_PAGE).toContain("snapshot.allQuestions");
    expect(ROOM_PAGE).toContain("snapshot.allScores");
    expect(ROOM_PAGE).toContain("scores={allScores}");
    expect(RECAP_PAGE).toContain("snapshot.myAnswers");
    expect(RECAP_PAGE).toContain("snapshot.scores");
    expect(WON_PAGE).toContain("snapshot.myAnswers");
    expect(WON_PAGE).toContain("snapshot.scores");
  });

  it("keeps signed snapshot array fallbacks stable across renders", () => {
    expect(ROOM_PAGE).not.toMatch(
      /snapshot\.(?:myAnswers|myParticipations|scores|allScores|allQuestions)\s*\?\?\s*\[\]/,
    );
  });

  it("does not fabricate an AnswerRow or locked state from an answer tap", () => {
    expect(ROOM_PAGE).not.toContain("optimisticAnswers");
    expect(ROOM_PAGE).not.toContain("onAnswerOptimistic");
    expect(ROOM_PAGE).not.toContain("optimistic-${question.id}");
    expect(ROOM_PAGE).not.toContain("setOptimisticAnswers");
  });

  it("uses game language in customer-facing missing and rejoin fallbacks", () => {
    expect(ROOM_PAGE).toContain("That game");
    expect(ROOM_PAGE).toContain("Pick a name to join the game.");
    expect(ROOM_PAGE).not.toContain("That room");
    expect(ROOM_PAGE).not.toContain("Pick a name to join the room.");
  });
});
