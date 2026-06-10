// Component test for the YOUR BOARD sidebar drag-and-drop + edit affordances
// added to HostGenPick.tsx.
//
// jsdom has no layout, so real pointer/keyboard drags can't be exercised here
// — the reorder MATH is covered by tests/unit/boardReorder.test.ts. This test
// guards the wiring that IS observable in jsdom:
//   - the per-card edit pencil opens the same handler the left grid uses,
//   - drag handles render only when reordering is enabled (handler + ≥2 cards),
//   - the /dev gallery (no handlers) stays static — no handles, no pencils.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  HostGenPick,
  type HostGenPickQuestion,
} from "@/components/host/gen/HostGenPick";

afterEach(() => cleanup());

// 7 picks at equal difficulty → stable sort keeps input order, so the board
// fills 100..700 as q0..q6 (q0 at the 100 slot, q6 at the 700 slot).
function sevenQuestions(): HostGenPickQuestion[] {
  return Array.from({ length: 7 }, (_, i) => ({
    id: `q${i}`,
    prompt: `Question ${i}`,
    options: ["A", "B", "C", "D"],
    correctIndex: 0,
    difficulty: 3,
  }));
}

describe("HostGenPick — YOUR BOARD reorder + edit affordances", () => {
  it("the board card pencil opens the edit handler with that question's id", () => {
    const onEdit = vi.fn();
    const questions = sevenQuestions();
    render(
      <HostGenPick
        themeKey="house"
        topic="Grunge bands"
        questions={questions}
        pickedIds={new Set(questions.map((q) => q.id))}
        onEdit={onEdit}
        onReorder={vi.fn()}
        onTogglePick={vi.fn()}
      />,
    );
    // The 100 slot holds q0; its pencil should fire onEdit("q0").
    fireEvent.click(screen.getByTestId("pick-sidebar-edit-100"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith("q0");

    // The 700 slot holds q6.
    fireEvent.click(screen.getByTestId("pick-sidebar-edit-700"));
    expect(onEdit).toHaveBeenCalledWith("q6");
  });

  it("renders a drag handle for every filled slot when reordering is enabled", () => {
    const questions = sevenQuestions();
    render(
      <HostGenPick
        themeKey="house"
        topic="Grunge bands"
        questions={questions}
        pickedIds={new Set(questions.map((q) => q.id))}
        onEdit={vi.fn()}
        onReorder={vi.fn()}
        onTogglePick={vi.fn()}
      />,
    );
    for (const v of [100, 200, 300, 400, 500, 600, 700]) {
      expect(screen.getByTestId(`pick-sidebar-drag-${v}`)).toBeTruthy();
    }
  });

  it("shows no drag handles when onReorder is absent (the /dev gallery is static)", () => {
    const questions = sevenQuestions();
    render(
      <HostGenPick
        themeKey="house"
        topic="Grunge bands"
        questions={questions}
        pickedIds={new Set(questions.map((q) => q.id))}
        onEdit={vi.fn()}
        onTogglePick={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("pick-sidebar-drag-100")).toBeNull();
    // Edit pencils still render — editing doesn't depend on drag.
    expect(screen.getByTestId("pick-sidebar-edit-100")).toBeTruthy();
  });

  it("shows no drag handles with only one pick (nothing to reorder)", () => {
    const questions = sevenQuestions();
    render(
      <HostGenPick
        themeKey="house"
        topic="Grunge bands"
        questions={questions}
        pickedIds={new Set(["q0"])}
        onEdit={vi.fn()}
        onReorder={vi.fn()}
        onTogglePick={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("pick-sidebar-drag-100")).toBeNull();
  });

  it("keeps the per-card pencil distinct from the unpick × (both present)", () => {
    const questions = sevenQuestions();
    render(
      <HostGenPick
        themeKey="house"
        topic="Grunge bands"
        questions={questions}
        pickedIds={new Set(questions.map((q) => q.id))}
        onEdit={vi.fn()}
        onReorder={vi.fn()}
        onTogglePick={vi.fn()}
      />,
    );
    expect(screen.getByTestId("pick-sidebar-edit-100")).toBeTruthy();
    expect(screen.getByTestId("pick-sidebar-unpick-100")).toBeTruthy();
    expect(screen.getByTestId("pick-sidebar-drag-100")).toBeTruthy();
  });
});
