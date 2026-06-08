// useMediaQuery — true when the given CSS media query currently matches.
//
// Used by the host-laptop screens to collapse their desktop multi-column
// grids into a single readable column on phones. Mirrors the SSR pattern of
// usePrefersReducedMotion: default to `false` so the server pass (and the
// hydration-matching first client render) always renders the DESKTOP branch,
// then read the real value on mount and re-render if it differs. That keeps
// the desktop layout byte-identical and confines the mobile branch to the
// client, where the viewport is actually known.

"use client";

import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    // Safari < 14 fallback (and any UA without addEventListener on MQL).
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, [query]);

  return matches;
}
