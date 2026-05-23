// Mount-once host for the PalettePeek overlay on the player surface.
// Listens for a custom `tr1via:peek` event (fired by the 5-tap egg) and
// for the player's very first session ever — auto-opens once after a
// short delay so the lobby renders first.

"use client";

import { useEffect, useState } from "react";
import { PalettePeek } from "./PalettePeek";
import { useFiveTapEgg, type FiveTapEggBindings } from "@/lib/hooks/useFiveTapEgg";

const FIRST_PEEK_KEY = "tr1via:peeked-v1";
const PEEK_EVENT = "tr1via:peek";

export function dispatchPeek() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PEEK_EVENT));
  }
}

/**
 * Bind these props onto any element that should accept the 5-tap-to-peek
 * gesture (almost always the TR1VIA wordmark).
 *
 * Returns props you spread; the trigger fires {@link dispatchPeek}.
 */
export function useEggBindings(): FiveTapEggBindings {
  return useFiveTapEgg({ onTrigger: dispatchPeek });
}

export function PalettePeekProvider() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(PEEK_EVENT, handler);
    return () => window.removeEventListener(PEEK_EVENT, handler);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    try {
      if (window.localStorage.getItem(FIRST_PEEK_KEY) === "1") return;
    } catch {
      // Some browsers (private mode, strict ITP) throw on localStorage access.
      // The egg is a delight, not a requirement — just bail silently.
      return;
    }
    const id = window.setTimeout(() => {
      if (cancelled) return;
      setOpen(true);
      try {
        window.localStorage.setItem(FIRST_PEEK_KEY, "1");
      } catch {
        // ditto
      }
    }, 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, []);

  return <PalettePeek open={open} onClose={() => setOpen(false)} />;
}
