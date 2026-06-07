// "The color year" — TR1VIA wears a different face every month.
//
// This renders the 12 monthly themes as a wall of tiny in-product screens, each
// painted in that month's REAL palette (straight from the theme registry — the
// single source of truth, zero duplicated colors) with its signature ambient
// motif drifting behind it. One <ThemeCard>, two contexts:
//   - <ThemeShowcase variant="teaser" /> → a horizontal scroll-strip + a link to
//     the full gallery, dropped into the /trivia-night marketing page.
//   - <ThemeShowcase variant="full" />   → the dedicated /themes gallery grid.
//
// Server component end-to-end (no client JS): indexable, fast, share-previewable.
// Motion is CSS-only (drift + staggered entrance), injected once via <Keyframes/>
// and disabled under prefers-reduced-motion. Palettes come from resolveTheme();
// the only thing this file adds is presentation.

import Link from "next/link";
import type { CSSProperties } from "react";
import { Display, Eyebrow } from "@/components/system";
import {
  Snowflake,
  Heart,
  Clover,
  Leaf,
  Pumpkin,
  Firework,
  Pine,
  Rain,
  Wheat,
} from "@/components/system/motifs";
import { weatherLabel } from "@/components/system/Weather";
import { resolveTheme } from "@/lib/theme/resolve";
import type { ThemeKey } from "@/lib/theme/tokens";

type Motif = (props: { size?: number; color?: string }) => React.JSX.Element;

// Two months whose ambient effect isn't a drifting particle get a local glyph
// so every card still carries its own signature mark: May's storm → a bolt,
// June's endless evening → a low sun.
function Bolt({ size = 12, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: "block" }}>
      <path d="M7 1 L2.5 7 H5.4 L4.5 11 L9.5 5 H6.6 Z" fill={color} />
    </svg>
  );
}
function Sun({ size = 12, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: "block" }}>
      <circle cx="6" cy="6" r="2.6" fill={color} />
      <g stroke={color} strokeWidth="1" strokeLinecap="round">
        <line x1="6" y1="0.5" x2="6" y2="1.8" />
        <line x1="6" y1="10.2" x2="6" y2="11.5" />
        <line x1="0.5" y1="6" x2="1.8" y2="6" />
        <line x1="10.2" y1="6" x2="11.5" y2="6" />
      </g>
    </svg>
  );
}

interface MonthSpec {
  key: ThemeKey;
  Motif: Motif;
}

// Calendar order — the eye should travel Jan → Dec and watch the palette turn.
const MONTHS: MonthSpec[] = [
  { key: "january", Motif: Snowflake },
  { key: "february", Motif: Heart },
  { key: "march", Motif: Clover },
  { key: "april", Motif: Rain },
  { key: "may", Motif: Bolt },
  { key: "june", Motif: Sun },
  { key: "july", Motif: Firework },
  { key: "august", Motif: Leaf },
  { key: "september", Motif: Leaf },
  { key: "october", Motif: Pumpkin },
  { key: "november", Motif: Wheat },
  { key: "december", Motif: Pine },
];

// Fixed constellation for the drifting motifs — deterministic (NOT Math.random)
// so server and client render byte-identical. Reused per card; the palette is
// what makes each one feel different.
const DRIFT = [
  { top: "14%", left: "9%", s: 1.0, d: "0s", big: false },
  { top: "30%", left: "80%", s: 1.4, d: "1.1s", big: false },
  { top: "64%", left: "14%", s: 1.2, d: "2.3s", big: false },
  { top: "78%", left: "82%", s: 0.95, d: "0.6s", big: false },
  { top: "46%", left: "52%", s: 2.0, d: "1.7s", big: true },
] as const;

function ThemeCard({ spec, index, size }: { spec: MonthSpec; index: number; size: "sm" | "lg" }) {
  const t = resolveTheme(spec.key);
  const { Motif } = spec;
  const [monthName, tag] = t.name.split("·").map((s) => s.trim());
  const lg = size === "lg";

  const glyphBase = lg ? 14 : 11;

  return (
    <article
      className="tns-card"
      style={
        {
          "--i": index,
          position: "relative",
          overflow: "hidden",
          flex: lg ? undefined : "0 0 auto",
          width: lg ? "100%" : "min(72vw, 244px)",
          aspectRatio: "5 / 4",
          borderRadius: lg ? 22 : 18,
          background: t.paper,
          border: `1px solid ${t.line}`,
          boxShadow: t.dark
            ? "0 20px 50px -28px rgba(0,0,0,0.8)"
            : "0 20px 50px -30px rgba(27,19,12,0.4)",
          scrollSnapAlign: lg ? undefined : "start",
        } as CSSProperties
      }
    >
      {/* Depth: a soft accent bloom in the upper-right, like the in-product glow */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(115% 80% at 78% 12%, ${t.accent}26, transparent 56%)`,
          pointerEvents: "none",
        }}
      />
      {/* Drifting signature motif — the ambient weather, frozen into a still */}
      <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {DRIFT.map((p, i) => (
          <span
            key={i}
            className="tns-drift"
            style={{
              position: "absolute",
              top: p.top,
              left: p.left,
              animationDelay: p.d,
              opacity: p.big ? 0.16 : 0.34,
            }}
          >
            <Motif size={glyphBase * p.s} color={p.big ? t.accent : t.pop} />
          </span>
        ))}
      </div>

      {/* Foreground */}
      <div
        style={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: lg ? "20px 22px" : "15px 16px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 700,
              fontSize: lg ? 15 : 12.5,
              letterSpacing: "-0.01em",
              color: t.ink,
            }}
          >
            TR
            <span style={{ fontFamily: "var(--font-mono)", color: t.accent }}>1</span>
            VIA
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: lg ? 9.5 : 8.5,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: t.inkMute,
            }}
          >
            {t.dark ? "Dark" : "Light"}
          </span>
        </div>

        <div>
          <Display
            size={lg ? "clamp(30px, 3.2vw, 40px)" : 23}
            color={t.ink}
            tracking={-0.035}
            style={{ display: "block", lineHeight: 0.92 }}
          >
            {monthName}
          </Display>
          {tag ? (
            <Eyebrow color={t.accent} size={lg ? 11 : 9.5} style={{ marginTop: lg ? 8 : 6 }}>
              {tag}
            </Eyebrow>
          ) : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          {/* Palette dots — accent / pop / correct / wrong, the four working colors */}
          <div style={{ display: "flex", gap: lg ? 7 : 5 }}>
            {[t.accent, t.pop, t.correct, t.wrong].map((c, i) => (
              <span
                key={i}
                style={{
                  width: lg ? 13 : 10,
                  height: lg ? 13 : 10,
                  borderRadius: 999,
                  background: c,
                  boxShadow: `0 0 0 1px ${t.line}`,
                }}
              />
            ))}
          </div>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: lg ? 10.5 : 9,
              letterSpacing: "0.04em",
              color: t.inkMid,
              textAlign: "right",
            }}
          >
            {weatherLabel(spec.key)}
          </span>
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
        className="tns-strip mt-9 flex gap-4 overflow-x-auto pb-3"
        style={{ scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}
      >
        {MONTHS.map((spec, i) => (
          <ThemeCard key={spec.key} spec={spec} index={i} size="sm" />
        ))}
      </div>
    </section>
  );
}

/** The full grid used by the dedicated /themes gallery page. */
function Gallery() {
  return (
    <div>
      <div
        className="grid gap-5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(248px, 1fr))" }}
      >
        {MONTHS.map((spec, i) => (
          <ThemeCard key={spec.key} spec={spec} index={i} size="lg" />
        ))}
      </div>
    </div>
  );
}

export function ThemeShowcase({ variant }: { variant: "teaser" | "full" }) {
  return variant === "teaser" ? <Teaser /> : <Gallery />;
}

// Exported for tests: the canonical ordered month list the showcase renders.
export const SHOWCASE_MONTHS = MONTHS.map((m) => m.key);
