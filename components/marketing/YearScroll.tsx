"use client";
// YearScroll — PROGRESSIVE ENHANCEMENT ONLY.
//
// The hub is already fully themed + readable from the server: every
// ThemedSection sets its month's palette inline, so scrolling already tours the
// year with zero JS. This island layers polish on top:
//   - tracks which section owns the viewport and mirrors its accent onto
//     <html> as `--ys-accent` (a fixed glow overlay can read it for a soft
//     cross-fade between months), and
//   - flips `data-ys-motion` on so ambient section motifs may animate.
//
// If JS never loads, or prefers-reduced-motion is set, the page is unchanged
// and fully functional. It mutates only its own attributes/vars on the root
// element — never any host/player/TV theme state.
import { useEffect } from "react";

export function YearScroll() {
  useEffect(() => {
    // Pure enhancement: bail safely where the APIs don't exist (jsdom in tests,
    // very old browsers). The page is already themed + readable without this.
    if (typeof IntersectionObserver === "undefined") return;
    const root = document.documentElement;
    const reduce = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-ys-section]"));
    if (sections.length === 0) return;

    if (!reduce) root.dataset.ysMotion = "on";

    const apply = (el: HTMLElement) => {
      const key = el.dataset.ysSection;
      if (!key || root.dataset.ysActive === key) return;
      root.dataset.ysActive = key;
      // Mirror the section's own accent so a global overlay can wash with it.
      const accent = getComputedStyle(el).getPropertyValue("--accent").trim();
      if (accent) root.style.setProperty("--ys-accent", accent);
    };

    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (top) apply(top.target as HTMLElement);
      },
      { threshold: [0.25, 0.5, 0.75] },
    );
    sections.forEach((s) => io.observe(s));

    return () => {
      io.disconnect();
      delete root.dataset.ysMotion;
      delete root.dataset.ysActive;
      root.style.removeProperty("--ys-accent");
    };
  }, []);

  return null;
}
