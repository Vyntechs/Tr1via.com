"use client";

// YearInOneTouch — the front-door "toy". The hero opens in the visitor's REAL
// current month and the 12-month rail below is a live controller: tap (or hover)
// a month and the ENTIRE SITE — colors, the product demo, the signature weather
// (July fireworks, December snow, May lightning) — repaints in ~260ms. Until the
// visitor touches it, the rail gently auto-drifts month to month so the
// transformation is visible even to someone who never lifts a finger.
//
// Crucially it drives the GLOBAL theme (the shared ThemeProvider that sets
// <html data-theme>), not just its own section — so the season the visitor is
// looking at FOLLOWS them when they click "Start hosting", "Join a game", etc.
// No jarring reset to a different theme on navigation.
//
// Progressive enhancement: the page is fully themed + readable from the server
// (initial paint uses ssrThemeKey, so crawlers and no-JS visitors get a complete
// themed page). This island only layers the live switching + drift on top, and
// it stays out of the way of reduced-motion visitors.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TR1VIA_THEMES, type ThemeKey } from "@/lib/theme/tokens";
import { MONTH_THEME_KEYS } from "@/lib/theme/monthThemeScript";
import { useTheme } from "@/components/system/ThemeProvider";
import { Weather } from "@/components/system";

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DRIFT_MS = 2200;

export function YearInOneTouch({
  ssrThemeKey,
  children,
}: {
  ssrThemeKey: ThemeKey;
  children: ReactNode;
}) {
  // The selected month IS the global site theme — so it carries across the app.
  const { themeKey, setThemeKey } = useTheme();
  const index = Math.max(0, MONTH_THEME_KEYS.indexOf(themeKey));
  const indexRef = useRef(index);
  indexRef.current = index;

  const ssrIndex = Math.max(0, MONTH_THEME_KEYS.indexOf(ssrThemeKey));
  const [homeIndex, setHomeIndex] = useState(ssrIndex);
  const [touched, setTouched] = useState(false);
  const touchedRef = useRef(false);

  // On mount, snap the whole site to the visitor's real current month (a cached
  // page may have been built in another month) and mark it "you're here".
  useEffect(() => {
    const live = new Date().getMonth();
    const key = MONTH_THEME_KEYS[live];
    if (key) {
      setHomeIndex(live);
      if (!touchedRef.current) setThemeKey(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-drift through the year until the first interaction; never after. Off for
  // reduced-motion visitors — the site simply rests on the current month.
  useEffect(() => {
    if (touched) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = window.setInterval(() => {
      if (touchedRef.current) return;
      const next = MONTH_THEME_KEYS[(indexRef.current + 1) % 12];
      if (next) setThemeKey(next);
    }, DRIFT_MS);
    return () => window.clearInterval(id);
  }, [touched, setThemeKey]);

  const pick = (i: number) => {
    const key = MONTH_THEME_KEYS[i];
    if (!key) return;
    touchedRef.current = true;
    setTouched(true);
    setThemeKey(key);
  };

  const selected = MONTH_THEME_KEYS[index] ?? ssrThemeKey;

  return (
    <section
      data-ys-section={selected}
      data-testid="year-in-one-touch"
      className="relative isolate overflow-hidden"
      style={{
        // Inherits the global theme's vars from <html data-theme>; the toy moves
        // that, so this whole block (and every page you click into) repaints.
        background: "var(--paper)",
        color: "var(--ink)",
        transition: "background-color 260ms ease, color 260ms ease",
      }}
    >
      {/* Live signature weather for the selected month — the real engine. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <Weather themeKey={selected} intensity={0.6} seed={index + 1} />
      </div>

      {children}

      {/* The interactive year rail — promoted from decoration to the control knob. */}
      <div className="mx-auto mb-2 max-w-[1140px] px-6">
        <p
          className="font-[family-name:var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: "var(--ink-mid)" }}
        >
          Tap a month — watch the whole room change ↓
        </p>
      </div>
      <div
        role="tablist"
        aria-label="Preview each month's look"
        className="flex w-full overflow-hidden"
      >
        {MONTH_THEME_KEYS.map((key, i) => {
          const active = i === index;
          const here = i === homeIndex;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`${MONTH_LABELS[i]}${here ? " (you're here)" : ""}`}
              onClick={() => pick(i)}
              onMouseEnter={() => pick(i)}
              onFocus={() => pick(i)}
              className="relative flex flex-1 cursor-pointer flex-col items-center justify-center border-0 py-4 text-white outline-none transition-transform duration-200 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-white/70"
              style={{
                background: TR1VIA_THEMES[key].accent,
                transform: active ? "scaleY(1.18)" : "scaleY(1)",
                boxShadow: active ? "inset 0 0 0 2px rgba(255,255,255,0.85)" : "none",
                opacity: active ? 1 : 0.82,
              }}
            >
              <span className="text-[11px] font-bold tracking-wide">{MONTH_LABELS[i]}</span>
              {here && <span className="text-[9px] leading-tight">{"you're here"}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
