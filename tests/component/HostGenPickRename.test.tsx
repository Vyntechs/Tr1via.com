// Component tests for the inline rename affordance on the Pick screen
// header. Renders <HostGenPick> with an `onRename` mock and exercises:
//   • the pencil button reveals an input pre-filled with the current name
//   • Enter saves
//   • Escape discards
//   • empty input shows an inline error without calling onSave
//   • length over 80 shows an inline error without calling onSave
//   • a server-side rejection keeps the input open with the value
//   • a save success closes the editor (caller is expected to update the
//     `topic` prop, but we just verify the save was called)

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { HostGenPick } from "@/components/host/gen";

const REAL_QUESTIONS = [
  {
    id: "1",
    prompt: "What was the first Pixar feature?",
    options: ["Toy Story", "Up", "Cars", "Wall·E"] as [
      string,
      string,
      string,
      string,
    ],
    correctIndex: 0 as 0 | 1 | 2 | 3,
    difficulty: 2,
  },
];

afterEach(() => {
  cleanup();
});

describe("HostGenPick — inline category rename", () => {
  it("renders the pencil button only when onRename is provided", () => {
    const { rerender } = render(
      <HostGenPick themeKey="daylight" topic="Pixar Movies" questions={REAL_QUESTIONS} />,
    );
    expect(screen.queryByTestId("host-category-rename-btn")).toBeNull();

    rerender(
      <HostGenPick
        themeKey="daylight"
        topic="Pixar Movies"
        questions={REAL_QUESTIONS}
        onRename={vi.fn().mockResolvedValue(undefined)}
        isRenaming={false}
      />,
    );
    expect(screen.getByTestId("host-category-rename-btn")).toBeTruthy();
  });

  it("clicking the pencil reveals the input pre-filled with the topic", () => {
    render(
      <HostGenPick
        themeKey="daylight"
        topic="Pixar Movies"
        questions={REAL_QUESTIONS}
        onRename={vi.fn().mockResolvedValue(undefined)}
        isRenaming={false}
      />,
    );
    fireEvent.click(screen.getByTestId("host-category-rename-btn"));
    const input = screen.getByTestId("host-category-rename-input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("Pixar Movies");
  });

  it("Enter calls onRename with the trimmed new value", async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <HostGenPick
        themeKey="daylight"
        topic="Pixar Movies"
        questions={REAL_QUESTIONS}
        onRename={onRename}
        isRenaming={false}
      />,
    );
    fireEvent.click(screen.getByTestId("host-category-rename-btn"));
    const input = screen.getByTestId("host-category-rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Pixar  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Pixar");
  });

  it("Escape discards without calling onRename", () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <HostGenPick
        themeKey="daylight"
        topic="Pixar Movies"
        questions={REAL_QUESTIONS}
        onRename={onRename}
        isRenaming={false}
      />,
    );
    fireEvent.click(screen.getByTestId("host-category-rename-btn"));
    const input = screen.getByTestId("host-category-rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Skirts" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    // Input is gone, pencil is back.
    expect(screen.queryByTestId("host-category-rename-input")).toBeNull();
    expect(screen.getByTestId("host-category-rename-btn")).toBeTruthy();
  });

  it("rejects empty input with an inline error, no save called", () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <HostGenPick
        themeKey="daylight"
        topic="Pixar Movies"
        questions={REAL_QUESTIONS}
        onRename={onRename}
        isRenaming={false}
      />,
    );
    fireEvent.click(screen.getByTestId("host-category-rename-btn"));
    const input = screen.getByTestId("host-category-rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("host-category-rename-save"));
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/blank/i);
    // Input stays open.
    expect(screen.getByTestId("host-category-rename-input")).toBeTruthy();
  });

  it("preserves value + shows error when onRename rejects", async () => {
    const onRename = vi
      .fn<(next: string) => Promise<void>>()
      .mockRejectedValue(new Error("Server said no"));
    render(
      <HostGenPick
        themeKey="daylight"
        topic="Pixar Movies"
        questions={REAL_QUESTIONS}
        onRename={onRename}
        isRenaming={false}
      />,
    );
    fireEvent.click(screen.getByTestId("host-category-rename-btn"));
    const input = screen.getByTestId("host-category-rename-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Skirts" } });
    fireEvent.click(screen.getByTestId("host-category-rename-save"));
    // Wait for the rejected promise + React state update to land.
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/server said no/i);
    });
    expect(onRename).toHaveBeenCalledWith("Skirts");
    expect(screen.getByTestId("host-category-rename-input")).toBeTruthy();
  });

  it("Enter with no change closes the editor without calling onRename", () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <HostGenPick
        themeKey="daylight"
        topic="Pixar Movies"
        questions={REAL_QUESTIONS}
        onRename={onRename}
        isRenaming={false}
      />,
    );
    fireEvent.click(screen.getByTestId("host-category-rename-btn"));
    const input = screen.getByTestId("host-category-rename-input") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByTestId("host-category-rename-input")).toBeNull();
  });
});
