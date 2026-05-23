// usePrefersReducedMotion — true when the OS / browser is configured to
// minimize non-essential motion. Drives a hard skip on decorative motion
// (particle fields, lightning flickers, weather effects) — globals.css
// already neutralizes pure CSS animations, but JS-driven particles can
// freeze in awkward positions, so it's cleaner to not render them at all.

"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  // Default to `false` so the SSR pass renders motion; on hydrate we read
  // the actual preference and re-render if it differs.
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(QUERY);
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    // Safari < 14 fallback (and any UA without addEventListener on MQL).
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  return reduced;
}
