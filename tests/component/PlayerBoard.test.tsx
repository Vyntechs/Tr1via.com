import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerBoard } from "@/components/player/PlayerBoard";
import { ThemeProvider } from "@/components/system";
import type { CategoryRow, QuestionRow } from "@/lib/supabase/types";

const categories = [
  { id: "c1", game_id: "g1", name: "Movies", position: 0, state: "ready" } as CategoryRow,
  { id: "c2", game_id: "g1", name: "Science", position: 1, state: "ready" } as CategoryRow,
];

const q = (
  id: string,
  category_id: string,
  point_value: number,
  played: boolean,
): QuestionRow =>
  ({
    id,
    category_id,
    point_value,
    difficulty: point_value / 100,
    is_picked: true,
    played_at: played ? "2026-07-20T00:30:00Z" : null,
    finished_at: played ? "2026-07-20T00:31:00Z" : null,
  }) as QuestionRow;

const questions = [
  q("q1", "c1", 100, true), // Movies 100 — already played
  q("q2", "c1", 200, false),
  q("q3", "c2", 100, false),
];

function renderBoard() {
  return render(
    <ThemeProvider themeKey="house">
      <PlayerBoard categories={categories} questions={questions} />
    </ThemeProvider>,
  );
}

describe("PlayerBoard (read-only, TV-independent)", () => {
  it("renders a column per category so a player who can't see the TV still has the board", () => {
    renderBoard();
    expect(screen.getByRole("grid", { name: /board/i })).toBeInTheDocument();
    expect(screen.getByText("Movies")).toBeVisible();
    expect(screen.getByText("Science")).toBeVisible();
  });

  it("marks a played question's cell as played", () => {
    renderBoard();
    // The Movies 100 question is played; its cell announces that state.
    expect(
      screen.getByRole("gridcell", { name: /Movies.*100.*played/i }),
    ).toBeInTheDocument();
    // An unplayed cell does not.
    expect(
      screen.getByRole("gridcell", { name: /Science.*100/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("gridcell", { name: /Science.*100.*played/i }),
    ).not.toBeInTheDocument();
  });

  it("is strictly read-only — no interactive controls for the player", () => {
    renderBoard();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
