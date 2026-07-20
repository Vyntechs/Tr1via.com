import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HostPhoneBoard } from "@/components/host/HostPhoneBoard";
import { ThemeProvider } from "@/components/system";
import type { CategoryRow, QuestionRow } from "@/lib/supabase/types";

function category(id: string, name: string, position: number): CategoryRow {
  return {
    id,
    game_id: "game-1",
    name,
    topic: name,
    position,
    color: null,
    state: "ready",
    flavor: null,
    created_at: "2026-07-19T00:00:00Z",
  };
}

function question(categoryId: string, value: QuestionRow["point_value"]): QuestionRow {
  return {
    id: `${categoryId}-${value}`,
    category_id: categoryId,
    prompt: `${categoryId} prompt for ${value}`,
    options: ["One", "Two", "Three", "Four"],
    correct_index: 1,
    difficulty: (value ?? 100) / 100,
    point_value: value,
    fact_blurb: "A useful host note.",
    image_url: null,
    image_attribution: null,
    image_source: null,
    is_picked: true,
    played_at: null,
    finished_at: null,
    source: "ai",
  };
}

const categories = [
  category("music", "Music", 1),
  category("food", "Food & Drink", 2),
  category("places", "Places", 3),
];
const values = [100, 200, 300, 400, 500, 600, 700] as const;
const questions = categories.flatMap((item) =>
  values.map((value) => question(item.id, value)),
);

function renderBoard(overrides: {
  categories?: CategoryRow[];
  questions?: QuestionRow[];
  selectedQuestionId?: string | null;
  onSelect?: (questionId: string) => void;
} = {}) {
  const onSelect = overrides.onSelect ?? vi.fn();
  render(
    <ThemeProvider themeKey="march">
      <HostPhoneBoard
        categories={overrides.categories ?? categories}
        questions={overrides.questions ?? questions}
        selectedQuestionId={overrides.selectedQuestionId ?? null}
        onSelect={onSelect}
      />
    </ThemeProvider>,
  );
  return { onSelect };
}

describe("HostPhoneBoard", () => {
  it("renders the ordered three-category by seven-value board and selects the exact cell", () => {
    const { onSelect } = renderBoard({ categories: [...categories].reverse() });

    expect(screen.getAllByRole("columnheader").map((node) => node.textContent)).toEqual([
      "Music",
      "Food & Drink",
      "Places",
    ]);
    expect(screen.getAllByRole("button", { name: /points/ })).toHaveLength(21);

    fireEvent.click(screen.getByRole("button", { name: "Music for 300 points" }));
    expect(onSelect).toHaveBeenCalledWith("music-300");
  });

  it("keeps played and missing cells visible but disabled", () => {
    const played = { ...question("music", 100), played_at: "2026-07-19T01:00:00Z" };
    const withoutFood200 = questions.filter((item) => item.id !== "food-200");
    renderBoard({ questions: [played, ...withoutFood200.filter((item) => item.id !== played.id)] });

    expect(screen.getByRole("button", { name: "Music for 100 points · Played" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Food & Drink for 200 points · Not available" })).toBeDisabled();
  });

  it("preserves extra categories while keeping every cell a 48px touch target", () => {
    const fourth = category("sports", "Sports", 4);
    renderBoard({
      categories: [...categories, fourth],
      questions: [...questions, ...values.map((value) => question(fourth.id, value))],
    });

    expect(screen.getAllByRole("columnheader")).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /points/ })).toHaveLength(28);
    expect(screen.getByRole("button", { name: "Sports for 700 points" })).toHaveStyle({ minHeight: "48px" });
  });
});
