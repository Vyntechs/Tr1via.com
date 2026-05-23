// useAnswerKeyboard — listen for digit keys 1..4 and call onSlot(n) for
// each. Disabled when the player has already locked or the screen isn't
// the question. Skips when the active element is editable (so typing a
// name in a form field doesn't lock an answer).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useAnswerKeyboard } from "@/lib/hooks/useAnswerKeyboard";

function press(key: string, opts: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}) {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key, ctrlKey: opts.ctrl, metaKey: opts.meta, altKey: opts.alt, bubbles: true }),
  );
}

describe("useAnswerKeyboard", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("calls onSlot(n) for the keys 1..4 when enabled", () => {
    const onSlot = vi.fn();
    renderHook(() => useAnswerKeyboard({ enabled: true, onSlot }));
    press("1");
    press("2");
    press("3");
    press("4");
    expect(onSlot).toHaveBeenCalledTimes(4);
    expect(onSlot.mock.calls).toEqual([[1], [2], [3], [4]]);
  });

  it("ignores keys outside 1..4", () => {
    const onSlot = vi.fn();
    renderHook(() => useAnswerKeyboard({ enabled: true, onSlot }));
    press("0");
    press("5");
    press("a");
    press("Enter");
    expect(onSlot).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onSlot = vi.fn();
    renderHook(() => useAnswerKeyboard({ enabled: false, onSlot }));
    press("1");
    expect(onSlot).not.toHaveBeenCalled();
  });

  it("ignores key combos with a modifier (so cmd+1 / ctrl+1 don't fire)", () => {
    const onSlot = vi.fn();
    renderHook(() => useAnswerKeyboard({ enabled: true, onSlot }));
    press("1", { meta: true });
    press("2", { ctrl: true });
    press("3", { alt: true });
    expect(onSlot).not.toHaveBeenCalled();
  });

  it("skips when an editable element has focus", () => {
    const onSlot = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderHook(() => useAnswerKeyboard({ enabled: true, onSlot }));
    press("1");
    expect(onSlot).not.toHaveBeenCalled();
  });
});
