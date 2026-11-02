// Name box behaviour shared by the phone join screen and the host's
// latecomer box: 16 visible characters, cleaned of invisible characters,
// and safe for Japanese/Chinese/Korean keyboards.
//
// The browser edits the text first. Then, if the result is over the cap,
// only the newly inserted piece is shortened (like a native maxLength) and
// the cursor goes right after what was kept. While a keyboard is still
// converting letters (IME composition), the text is left alone: changing
// it mid-conversion cancels or commits the half-typed word on iOS. The cap
// is applied once the conversion finishes.

import { useEffect, useRef } from "react";
import type { ChangeEvent, CompositionEvent } from "react";
import { fitNameEdit } from "@/lib/player/nameLimit";

export function useCappedNameInput(name: string, setName: (value: string) => void) {
  const composing = useRef(false);
  // The last capped value: what the box held before the current edit.
  const committed = useRef(name);

  useEffect(() => {
    // Picks up outside changes (a prefill, a reset) but never the raw
    // in-progress text of a conversion.
    if (!composing.current) committed.current = name;
  }, [name]);

  function commit(input: HTMLInputElement) {
    const next = input.value;
    const { value, caret } = fitNameEdit(committed.current, next, input.selectionStart);
    committed.current = value;
    if (value !== next) {
      // Write the box directly so React sees it already matches and doesn't
      // rewrite it (which would throw the cursor to the end).
      input.value = value;
      try {
        input.setSelectionRange(caret, caret);
      } catch {
        // Some input types don't support selection; the value is what matters.
      }
    }
    setName(value);
  }

  return {
    onChange(e: ChangeEvent<HTMLInputElement>) {
      const native = e.nativeEvent as Partial<InputEvent>;
      if (composing.current || native.isComposing) {
        setName(e.target.value);
        return;
      }
      commit(e.target);
    },
    onCompositionStart() {
      composing.current = true;
    },
    onCompositionEnd(e: CompositionEvent<HTMLInputElement>) {
      composing.current = false;
      commit(e.currentTarget);
    },
  };
}
