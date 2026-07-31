// HostGenEdit — the inline edit panel rendered over the pick workspace.
//
// These tests guard the contract between HostGenEdit and its parent
// (HostSetupPickClient). The parent must receive the host's in-progress
// edits when the user transitions to the image-swap modal — otherwise the
// local form state is destroyed at unmount and the edits never reach the
// database.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { HostGenEdit, type HostGenEditValues } from "@/components/host/gen/HostGenEdit";

const INITIAL: HostGenEditValues = {
  prompt: "Initial question — replace me",
  options: ["alpha", "bravo", "charlie", "delta"],
  correctIndex: 0,
  factBlurb: "A fun fact belonging to the ORIGINAL question.",
  pointValue: 200,
};

/** The panel renders the prompt first and the fun fact second. */
function textareas(container: HTMLElement) {
  const all = container.querySelectorAll("textarea");
  return { prompt: all[0] as HTMLTextAreaElement, fact: all[1] as HTMLTextAreaElement };
}

afterEach(() => cleanup());

describe("HostGenEdit", () => {
  it("Save · this question fires onSave with the current edit values", () => {
    const onSave = vi.fn();
    const { container } = render(
      <HostGenEdit
        themeKey="house"
        topic="Test"
        initial={INITIAL}
        onSave={onSave}
      />,
    );

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Edited question text" } });

    fireEvent.click(screen.getByRole("button", { name: /save · this question/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]![0]).toMatchObject({
      prompt: "Edited question text",
      options: ["alpha", "bravo", "charlie", "delta"],
      correctIndex: 0,
      pointValue: 200,
    });
  });

  it("Swap image → forwards the current edit values so the parent can save them before unmount", () => {
    // Regression guard. Before this fix, clicking "Swap image →" only flipped
    // the parent's modal state, unmounting HostGenEdit and destroying the
    // local form state. Any pending text/options/correct/point edits were
    // silently lost. The fix: pass current values up, parent persists, THEN
    // opens the swap modal.
    const onSwapImage = vi.fn();
    const { container } = render(
      <HostGenEdit
        themeKey="house"
        topic="Test"
        initial={INITIAL}
        onSwapImage={onSwapImage}
      />,
    );

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "Edited just before clicking swap" },
    });

    fireEvent.click(screen.getByRole("button", { name: /swap image/i }));
    expect(onSwapImage).toHaveBeenCalledTimes(1);
    expect(onSwapImage.mock.calls[0]![0]).toMatchObject({
      prompt: "Edited just before clicking swap",
      options: INITIAL.options,
      correctIndex: INITIAL.correctIndex,
      pointValue: INITIAL.pointValue,
    });
  });

  it("Swap image → captures option / correct-mark / point-value changes too", () => {
    const onSwapImage = vi.fn();
    render(
      <HostGenEdit
        themeKey="house"
        topic="Test"
        initial={INITIAL}
        onSwapImage={onSwapImage}
      />,
    );

    // Change the 2nd option, mark the 3rd option as correct, change point value to 600.
    // Initial correctIndex=0 means rows 2/3/4 each render a "Make correct" button.
    const optionInputs = screen.getAllByDisplayValue(/^(alpha|bravo|charlie|delta)$/);
    fireEvent.change(optionInputs[1]!, { target: { value: "BRAVO-edited" } });
    const markButtons = screen.getAllByRole("button", { name: /^make correct$/i });
    // markButtons[0] -> row 2, markButtons[1] -> row 3, markButtons[2] -> row 4.
    fireEvent.click(markButtons[1]!);
    fireEvent.click(screen.getByRole("button", { name: "600" }));

    fireEvent.click(screen.getByRole("button", { name: /swap image/i }));
    expect(onSwapImage).toHaveBeenCalledTimes(1);
    const passed = onSwapImage.mock.calls[0]![0] as HostGenEditValues;
    expect(passed.options[1]).toBe("BRAVO-edited");
    expect(passed.correctIndex).toBe(2);
    expect(passed.pointValue).toBe(600);
  });

  it("Swap image button is disabled while a save is in flight", () => {
    const onSwapImage = vi.fn();
    render(
      <HostGenEdit
        themeKey="house"
        topic="Test"
        initial={INITIAL}
        onSwapImage={onSwapImage}
        isSaving={true}
      />,
    );
    const swap = screen.getByRole("button", { name: /swap image/i });
    expect(swap).toBeDisabled();
    fireEvent.click(swap);
    expect(onSwapImage).not.toHaveBeenCalled();
  });

  // ── the fun fact (issue #173) ──────────────────────────────────────────
  //
  // Heather, 2026-07-29: "anytime she edited a question or entered her own,
  // the little fun fact she reads after the answer never updates." It didn't
  // — the panel had no such field, so the blurb written for whatever question
  // previously occupied the row survived every edit, invisibly, and she read
  // it out as fact. Live consequence: "The square root of 900 is:" carried a
  // 5-12-13 Pythagorean-triple blurb.
  describe("fun fact", () => {
    it("shows the existing blurb so a stale one is visible before the show", () => {
      const { container } = render(
        <HostGenEdit themeKey="house" topic="Test" initial={INITIAL} />,
      );
      expect(textareas(container).fact.value).toBe(
        "A fun fact belonging to the ORIGINAL question.",
      );
    });

    it("sends the edited blurb on save", () => {
      const onSave = vi.fn();
      const { container } = render(
        <HostGenEdit themeKey="house" topic="Test" initial={INITIAL} onSave={onSave} />,
      );

      const { prompt, fact } = textareas(container);
      fireEvent.change(prompt, { target: { value: "The square root of 900 is:" } });
      fireEvent.change(fact, { target: { value: "30 x 30 = 900." } });

      fireEvent.click(screen.getByRole("button", { name: /save · this question/i }));
      expect(onSave.mock.calls[0]![0]).toMatchObject({
        prompt: "The square root of 900 is:",
        factBlurb: "30 x 30 = 900.",
      });
    });

    it("lets the host empty the blurb — silence beats a wrong fact read aloud", () => {
      const onSave = vi.fn();
      const { container } = render(
        <HostGenEdit themeKey="house" topic="Test" initial={INITIAL} onSave={onSave} />,
      );
      fireEvent.change(textareas(container).fact, { target: { value: "" } });
      fireEvent.click(screen.getByRole("button", { name: /save · this question/i }));
      expect((onSave.mock.calls[0]![0] as HostGenEditValues).factBlurb).toBe("");
    });

    it("carries the blurb through the image-swap hand-off like every other field", () => {
      const onSwapImage = vi.fn();
      const { container } = render(
        <HostGenEdit themeKey="house" topic="Test" initial={INITIAL} onSwapImage={onSwapImage} />,
      );
      fireEvent.change(textareas(container).fact, { target: { value: "Edited then swapped." } });
      fireEvent.click(screen.getByRole("button", { name: /swap image/i }));
      expect((onSwapImage.mock.calls[0]![0] as HostGenEditValues).factBlurb).toBe(
        "Edited then swapped.",
      );
    });

    it("blocks save past the 280-char cap the route enforces, instead of failing the write", () => {
      const onSave = vi.fn();
      const { container } = render(
        <HostGenEdit themeKey="house" topic="Test" initial={INITIAL} onSave={onSave} />,
      );
      fireEvent.change(textareas(container).fact, { target: { value: "x".repeat(281) } });

      const save = screen.getByRole("button", { name: /too long/i });
      expect(save).toBeDisabled();
      fireEvent.click(save);
      expect(onSave).not.toHaveBeenCalled();
    });
  });
});
