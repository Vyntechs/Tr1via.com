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
  pointValue: 200,
};

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
    // Initial correctIndex=0 means rows 2/3/4 each render a "mark" button.
    const optionInputs = screen.getAllByDisplayValue(/^(alpha|bravo|charlie|delta)$/);
    fireEvent.change(optionInputs[1]!, { target: { value: "BRAVO-edited" } });
    const markButtons = screen.getAllByRole("button", { name: /^mark$/i });
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
});
