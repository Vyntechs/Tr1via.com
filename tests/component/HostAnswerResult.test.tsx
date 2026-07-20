import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HostAnswerResult } from "@/components/host/HostAnswerResult";
import type { AnswerRow, PlayerRow, QuestionRow } from "@/lib/supabase/types";

const question: QuestionRow = {
  id: "q1",
  category_id: "c1",
  prompt: "Which ingredient?",
  options: ["Sodium lauryl sulfate", "Triclosan", "Benzalkonium chloride", "Glycerin"],
  correct_index: 1,
  difficulty: 3,
  point_value: 300,
  fact_blurb: "The FDA required stronger evidence for long-term daily use.",
  image_url: null,
  image_attribution: null,
  image_source: null,
  is_picked: true,
  played_at: "2026-07-20T00:00:00Z",
  finished_at: "2026-07-20T00:00:30Z",
  source: "ai",
};

function answer(
  id: string,
  playerId: string,
  chosenIndex: 0 | 1 | 2 | 3,
  ms: number,
  lockedAt: string,
  isCorrect: boolean | null = chosenIndex === 1,
): AnswerRow {
  return {
    id,
    question_id: "q1",
    player_id: playerId,
    chosen_index: chosenIndex,
    scramble: [0, 1, 2, 3],
    locked_at: lockedAt,
    ms_to_lock: ms,
    is_correct: isCorrect,
    awarded_points: isCorrect ? 300 : 0,
  };
}

function player(id: string, name: string): PlayerRow {
  return {
    id,
    night_id: "night-1",
    device_id: `device-${id}`,
    display_name: name,
    joined_at: "2026-07-20T00:00:00Z",
    last_seen_at: "2026-07-20T00:00:00Z",
    removed_at: null,
    app_switch_total_seconds: 0,
    can_answer: true,
  };
}

describe("HostAnswerResult", () => {
  it("deduplicates canonical player answers before result math, distribution, and fastest five", () => {
    const answers: AnswerRow[] = [
      answer("p1-stale", "p1", 0, 900, "2026-07-20T00:00:05Z", null),
      answer("p1-final", "p1", 1, 1_200, "2026-07-20T00:00:06Z", true),
      answer("p2", "p2", 1, 2_000, "2026-07-20T00:00:07Z"),
      answer("p3", "p3", 2, 3_000, "2026-07-20T00:00:08Z"),
      answer("other-question", "p4", 1, 400, "2026-07-20T00:00:09Z"),
    ];
    answers[4] = { ...answers[4], question_id: "q-old" };
    const onReturnToBoard = vi.fn();

    render(
      <HostAnswerResult
        themeKey="march"
        question={question}
        answers={answers}
        players={[player("p1", "SC"), player("p2", "Lauren"), player("p3", "Net Slapper")]}
        onReturnToBoard={onReturnToBoard}
      />,
    );

    expect(screen.getByText("2 Triclosan")).toBeVisible();
    expect(screen.getByText("2 of 3 correct · 67%")).toBeVisible();
    expect(within(screen.getByTestId("answer-choice-1")).getByText("0")).toBeVisible();
    expect(within(screen.getByTestId("answer-choice-2")).getAllByText("2")).toHaveLength(2);
    expect(within(screen.getByTestId("answer-choice-3")).getByText("1")).toBeVisible();
    expect(screen.getByText(/1\s+SC/)).toBeVisible();
    expect(screen.getByText(/2\s+Lauren/)).toBeVisible();
    expect(screen.queryByText("p4")).not.toBeInTheDocument();
    expect(screen.getByText(question.fact_blurb!)).toBeVisible();

    const returnButton = screen.getByRole("button", { name: "Return to board" });
    expect(returnButton).toHaveStyle({ minHeight: "48px" });
    fireEvent.click(returnButton);
    expect(onReturnToBoard).toHaveBeenCalledTimes(1);
  });

  it("uses zero-safe math and an honest empty fastest state", () => {
    render(
      <HostAnswerResult
        themeKey="april"
        question={question}
        answers={[]}
        players={[]}
        onReturnToBoard={vi.fn()}
      />,
    );

    expect(screen.getByText("0 of 0 correct · 0%")).toBeVisible();
    expect(screen.getByText("No confirmed correct responses")).toBeVisible();
    expect(screen.getAllByText("0")).toHaveLength(4);
    expect(screen.queryByText(/shown everywhere|TV live|phones current/i)).not.toBeInTheDocument();
  });
});
