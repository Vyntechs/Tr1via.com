import { describe, it, expect } from "vitest";
import {
  serializeBoardQuestion,
  type TVBoardQuestionRow,
} from "@/lib/tv/serializeBoardQuestion";

function row(overrides: Partial<TVBoardQuestionRow> = {}): TVBoardQuestionRow {
  return {
    id: "q1",
    category_id: "c1",
    point_value: 300,
    prompt: "Capital of France?",
    options: ["Paris", "Lyon", "Nice", "Marseille"],
    correct_index: 0,
    image_url: null,
    fact_blurb: null,
    played_at: null,
    finished_at: null,
    is_picked: true,
    ...overrides,
  };
}

describe("serializeBoardQuestion — public TV feed answer gating", () => {
  it("WITHHOLDS correctIndex for an unplayed question (played_at null)", () => {
    expect(serializeBoardQuestion(row()).correctIndex).toBeNull();
  });

  it("WITHHOLDS correctIndex for a LIVE question (played, not finished)", () => {
    // This is the exploit window: question on screen, answer window open.
    const out = serializeBoardQuestion(
      row({ played_at: "2026-06-07T00:00:00Z", finished_at: null }),
    );
    expect(out.correctIndex).toBeNull();
  });

  it("EXPOSES correctIndex once the question is RESOLVED (finished_at set)", () => {
    const out = serializeBoardQuestion(
      row({
        correct_index: 2,
        played_at: "2026-06-07T00:00:00Z",
        finished_at: "2026-06-07T00:00:20Z",
      }),
    );
    expect(out.correctIndex).toBe(2);
  });

  it("never leaks correct_index in the payload for an unresolved question", () => {
    const out = serializeBoardQuestion(
      row({ correct_index: 3, played_at: "2026-06-07T00:00:00Z" }),
    );
    // Belt-and-suspenders: the field is null and the raw value appears nowhere.
    expect(JSON.stringify(out)).not.toContain('"correctIndex":3');
    expect(out.correctIndex).toBeNull();
  });

  it("passes through the non-secret board fields unchanged", () => {
    const out = serializeBoardQuestion(
      row({ played_at: "2026-06-07T00:00:00Z", image_url: "http://x/y.jpg" }),
    );
    expect(out).toMatchObject({
      id: "q1",
      categoryId: "c1",
      pointValue: 300,
      prompt: "Capital of France?",
      options: ["Paris", "Lyon", "Nice", "Marseille"],
      imageUrl: "http://x/y.jpg",
      playedAt: "2026-06-07T00:00:00Z",
      isPicked: true,
    });
  });
});
