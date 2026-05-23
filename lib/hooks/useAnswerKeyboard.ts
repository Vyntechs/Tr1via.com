// useAnswerKeyboard — keys 1/2/3/4 select an answer slot.
//
// The 4 cards on the phone are slot 1..4 in the player's scramble; this
// hook turns the same digit keys into a tap. Useful for accessibility
// (BT keyboards, assistive switches that emit digit keys) and for tester
// flows on a laptop.
//
// Bails when the active element is editable so typing a name in the join
// input doesn't accidentally lock an answer.

"use client";

import { useEffect } from "react";

export interface UseAnswerKeyboardOptions {
  /** Toggle without re-mounting (e.g. once the player has locked). */
  enabled: boolean;
  /** Called with 1..4 when the player presses the matching digit. */
  onSlot: (slot: 1 | 2 | 3 | 4) => void;
}

const SLOT_KEYS: Record<string, 1 | 2 | 3 | 4> = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
};

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useAnswerKeyboard({ enabled, onSlot }: UseAnswerKeyboardOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const slot = SLOT_KEYS[event.key];
      if (!slot) return;
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      event.preventDefault();
      onSlot(slot);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled, onSlot]);
}
