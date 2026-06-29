// "The color year" — TR1VIA wears a different face every month.
//
// Each of the 12 monthly themes is rendered as a tiny LIVE in-product screen:
// the month's REAL palette (straight from the theme registry — single source of
// truth, zero duplicated colors), its REAL ambient weather drifting behind a
// mock question board (category banner + four answers, one correct). The eye
// travels January → December and watches the room change personality.
//
// One <ThemeCard>, two contexts:
//   - <ThemeShowcase variant="teaser" /> → a horizontal scroll-strip + a link to
//     the full gallery, dropped into the /trivia-night marketing page.
//   - <ThemeShowcase variant="full" />   → the dedicated /themes gallery grid.
//
// The card is a server component (month name, palette, category, answers all in
// the initial HTML → indexable). The weather is a client island (ParticleField),
// deterministic + reduced-motion-aware, so it adds life without breaking SSR.
//
// Weather fidelity: the 10 particle months use the SAME <Weather> the product
// runs. May (canvas lightning + procedural thunder AUDIO) and June (canvas sky)
// are "TV-only by construction" and would be wrong on a marketing page, so they
// get a light, silent particle stand-in (drifting bolts / suns) instead.

import Link from "next/link";
import type { CSSProperties } from "react";
import { Display, Eyebrow, Wordmark } from "@/components/system";
import { weatherLabel } from "@/components/system/Weather";
import { resolveTheme } from "@/lib/theme/resolve";
import { TR1VIA_CATEGORIES } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import { CardWeather } from "./CardWeather";

// Calendar order — the eye should travel Jan → Dec and watch the palette turn.
const MONTHS: ThemeKey[] = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function ThemeCard({ themeKey, index, size }: { themeKey: ThemeKey; index: number; size: "sm" | "lg" }) {
  const t = resolveTheme(themeKey);
  const [monthName, tag] = t.name.split("·").map((s) => s.trim());
  const cat = TR1VIA_CATEGORIES[index % TR1VIA_CATEGORIES.length];
  const correctIdx = index % 4;
  const lg = size === "lg";

  return (
    <article
      className="tns-card"
      style={
        {
          "--i": index,
          position: "relative",
          overflow: "hidden",
          flex: lg ? undefined : "0 0 auto",
          width: lg ? "100%" : "min(82vw, 308px)",
          aspectRatio: lg ? "1 / 1" : "4 / 3",
          borderRadius: lg ? 26 : 20,
          background: t.paper,
          border: `1px solid ${t.line}`,
          boxShadow: t.dark
            ? "0 26px 60px -30px rgba(0,0,0,0.85)"
            : "0 26px 60px -32px rgba(27,19,12,0.45)",
          scrollSnapAlign: lg ? undefined : "start",
        } as CSSProperties
      }
    >
      {/* LIVE ambient weather — the room's real motion, drifting behind */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.55 }}>
        <CardWeather themeKey={themeKey} seed={index + 1} />
      </div>
      {/* Accent bloom for depth (matches the in-product glow) */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 85% at 80% 8%, ${t.accent}2E, transparent 58%)`,
          pointerEvents: "none",
        }}
      />

      {/* Foreground: a mock question board */}
      <div
        style={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: lg ? "22px 24px" : "16px 17px",
          boxSizing: "border-box",
        }}
      >
        {/* Top bar: wordmark + category banner */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Wordmark
            size={lg ? 15 : 12.5}
            accent={t.accent}
            ink={t.ink}
            pop={t.pop}
            seasonalKey={themeKey}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: lg ? 10 : 9,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#15100A",
              background: cat.color,
              padding: lg ? "4px 10px" : "3px 8px",
              borderRadius: 999,
            }}
          >
            {cat.name}
          </span>
        </div>

        {/* The "question" headline = the month */}
        <div>
          <Display
            size={lg ? "clamp(34px, 3.4vw, 48px)" : 26}
            color={t.ink}
            tracking={-0.035}
            style={{ display: "block", lineHeight: 0.9 }}
          >
            {monthName}
          </Display>
          <Eyebrow color={t.accent} size={lg ? 11 : 9.5} style={{ marginTop: lg ? 9 : 6 }}>
            {tag ? `${tag} · ${weatherLabel(themeKey)}` : weatherLabel(themeKey)}
          </Eyebrow>
        </div>

        {/* Four answers — one is correct (the unmistakable trivia tell) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: lg ? 8 : 6 }}>
          {[0, 1, 2, 3].map((i) => {
            const correct = i === correctIdx;
            return (
              <div
                key={i}
                style={{
                  height: lg ? 26 : 20,
                  borderRadius: lg ? 9 : 7,
                  background: correct ? t.correct : t.surfaceH,
                  border: `1px solid ${correct ? "transparent" : t.line}`,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: lg ? 10 : 8,
                  gap: 7,
                }}
              >
                <span
                  style={{
                    width: lg ? 7 : 6,
                    height: lg ? 7 : 6,
                    borderRadius: 999,
                    background: correct ? (t.dark ? "#0C0A06" : "#FFFFFF") : t.inkMute,
                    flex: "0 0 auto",
                  }}
                />
                <span
                  style={{
                    height: lg ? 5 : 4,
                    width: `${[58, 42, 50, 38][i]}%`,
                    borderRadius: 999,
                    background: correct ? (t.dark ? "rgba(12,10,6,.55)" : "rgba(255,255,255,.7)") : t.inkMute,
                    opacity: correct ? 1 : 0.5,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

/** The teaser block embedded in the /trivia-night marketing page. */
function Teaser() {
  return (
    <section className="mx-auto mt-24 max-w-[1040px]">
      <Eyebrow color="var(--ink-mid)" size={12}>
        A NEW LOOK EVERY MONTH
      </Eyebrow>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <Display size="clamp(28px, 4vw, 40px)" color="var(--ink)" style={{ display: "block", maxWidth: 560 }}>
          TR1VIA dresses for the season.
        </Display>
        <Link
          href="/themes"
          data-testid="themes-teaser-link"
          className="font-[family-name:var(--font-mono)] text-[12px] font-semibold uppercase tracking-[0.14em] text-accent no-underline hover:underline"
        >
          See all 12 months →
        </Link>
      </div>
      <p className="mt-3 max-w-[600px] text-[15px] leading-relaxed" style={{ color: "var(--ink-mid)" }}>
        From January ice to October pumpkin glow to December pine — the whole room
        changes character with the calendar. Same game, twelve moods.
      </p>

      <div
        className="tns-strip mt-9 flex gap-5 overflow-x-auto pb-3"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        {MONTHS.map((key, i) => (
          <ThemeCard key={key} themeKey={key} index={i} size="sm" />
        ))}
      </div>
    </section>
  );
}

/** The full grid used by the dedicated /themes gallery page. */
function Gallery() {
  return (
    <div
      className="grid gap-6"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 332px), 1fr))" }}
    >
      {MONTHS.map((key, i) => (
        <ThemeCard key={key} themeKey={key} index={i} size="lg" />
      ))}
    </div>
  );
}

export function ThemeShowcase({ variant }: { variant: "teaser" | "full" }) {
  return variant === "teaser" ? <Teaser /> : <Gallery />;
}

// Exported for tests: the canonical ordered month list the showcase renders.
export const SHOWCASE_MONTHS = MONTHS;
