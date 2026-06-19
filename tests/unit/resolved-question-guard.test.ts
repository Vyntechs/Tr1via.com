import { describe, it, expect } from "vitest";
import { pickNewerResolvedQuestion } from "@/lib/hooks/resolvedQuestionState";
import type { QuestionRow } from "@/lib/supabase/types";

// Minimal fixture — the guard only reads `id` and `finished_at`.
function q(
  id: string,
  finishedAt: string | null,
  extra: Partial<QuestionRow> = {},
): QuestionRow {
  return { id, finished_at: finishedAt, ...extra } as QuestionRow;
}

// Repro of the 2026-06-19 PROD host-console flip-flop: the host ends Q-A (Canada,
// 400) early, then picks + resolves Q-B (Golden Gate, 100). A redelivered /
// out-of-order broadcast for the OLDER question A must NEVER overwrite the
// more-recently-resolved B in useRoom's single `lastResolvedQuestion` slot —
// that overwrite is what made the reveal screen oscillate A <-> B.
describe("pickNewerResolvedQuestion (host reveal flip-flop guard)", () => {
  const canada = q("A", "2026-06-19T15:47:00.000Z"); // ended early first
  const goldenGate = q("B", "2026-06-19T15:47:20.000Z"); // resolved 20s later

  it("keeps the newer resolved question when a stale OLDER one arrives", () => {
    // slot holds B; a stale broadcast brings A back — B must win
    expect(pickNewerResolvedQuestion(goldenGate, canada).id).toBe("B");
  });

  it("advances to a genuinely newer resolved question", () => {
    expect(pickNewerResolvedQuestion(canada, goldenGate).id).toBe("B");
  });

  it("refreshes the SAME question (correct_index / metadata backfill)", () => {
    const withoutAnswer = q("B", "2026-06-19T15:47:20.000Z");
    const withAnswer = q("B", "2026-06-19T15:47:20.000Z", { correct_index: 1 });
    const result = pickNewerResolvedQuestion(withoutAnswer, withAnswer);
    expect(result.id).toBe("B");
    expect(result.correct_index).toBe(1);
  });

  it("takes the incoming question when there is no prior resolved question", () => {
    expect(pickNewerResolvedQuestion(null, canada).id).toBe("A");
  });
});
