// /themes — the public theme gallery.
//
// The dedicated home for "TR1VIA looks different every month." The /trivia-night
// marketing page carries a teaser strip; this page is the full wall — all twelve
// monthly themes rendered in their real palettes, calendar order, January through
// December. Same <ThemeShowcase> component as the teaser (one source of truth);
// here it runs in "full" variant.
//
// Hand-written server component (mirrors /trivia-night and /privacy): statically
// rendered, fully in the HTML → indexable + share-previewable, zero client JS.
// Inherits the daylight theme tokens (paper/ink/accent) from the root layout's
// ThemeProvider; the showcase cards paint themselves in each month's own palette.
//
// Scope guard: markets the product, doesn't modify it. Links only to existing
// routes (/login to host, /trivia-night back to the pitch).

import type { Metadata } from "next";
import Link from "next/link";
import { Display, Eyebrow } from "@/components/system";
import { ThemeShowcase } from "@/components/marketing/ThemeShowcase";

const TITLE = "A new theme every month";
const SOCIAL_TITLE = `${TITLE} · TR1VIA`;
const DESCRIPTION =
  "TR1VIA wears a different face every month — January ice, July fireworks, October pumpkin glow, December pine. Twelve seasonal themes, each its own palette and ambient motion, on the same free live-trivia game.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://tr1via.com/themes" },
  keywords: [
    "trivia themes",
    "seasonal trivia night",
    "monthly trivia themes",
    "themed trivia game",
    "holiday trivia night",
  ],
  openGraph: {
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "https://tr1via.com/themes",
    siteName: "TR1VIA",
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
  },
};

const LINE = "var(--line)";
const SURFACE = "var(--surface)";
const INK_MID = "var(--ink-mid)";

export default function ThemesPage() {
  return (
    <main className="min-h-[100dvh] bg-paper px-6 pb-24 text-ink sm:px-8">
      {/* Header — wordmark + the host sign-in chip (mirrors /trivia-night) */}
      <header className="mx-auto flex max-w-[1100px] items-center justify-between py-6">
        <Link href="/trivia-night" className="no-underline" aria-label="TR1VIA home">
          <span className="font-[family-name:var(--font-sans)] text-[22px] font-bold tracking-tight text-ink">
            TR<span className="font-[family-name:var(--font-mono)] text-accent">1</span>VIA
          </span>
        </Link>
        <Link
          href="/login"
          className="rounded-full px-4 py-2 font-[family-name:var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.16em] text-ink no-underline"
          style={{ border: `1px solid ${LINE}`, background: SURFACE }}
        >
          Host · Sign in →
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-[1100px] pt-10 sm:pt-16">
        <Eyebrow color="var(--accent)" size={12}>
          TWELVE MONTHS · TWELVE MOODS
        </Eyebrow>
        <Display
          size="clamp(40px, 7vw, 80px)"
          color="var(--ink)"
          tracking={-0.04}
          style={{ display: "block", marginTop: 16, maxWidth: 820 }}
        >
          The color year.
        </Display>
        <p className="mt-6 max-w-[620px] text-[18px] leading-relaxed" style={{ color: INK_MID }}>
          The game never changes — the room does. Every month TR1VIA shifts its
          whole palette and ambient motion to match the season, so your December
          night feels nothing like your July one. Hosts can lock any theme they
          like; by default it just follows the calendar.
        </p>
      </section>

      {/* The full wall */}
      <section className="mx-auto mt-14 max-w-[1100px]">
        <ThemeShowcase variant="full" />
      </section>

      {/* CTA back to the pitch */}
      <section className="mx-auto mt-20 max-w-[1100px] text-center">
        <Display size="clamp(26px, 4vw, 40px)" color="var(--ink)" style={{ display: "block" }}>
          Pick a month. Start hosting.
        </Display>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/login"
            className="rounded-2xl bg-accent px-7 py-4 text-[16px] font-bold text-white no-underline"
            style={{ boxShadow: "0 14px 30px -10px var(--accent)" }}
          >
            Start hosting — free →
          </Link>
          <Link
            href="/trivia-night"
            data-testid="themes-back-to-marketing"
            className="rounded-2xl px-7 py-4 text-[16px] font-semibold text-ink no-underline"
            style={{ border: `1px solid ${LINE}`, background: SURFACE }}
          >
            ← Back to the overview
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="mx-auto mt-20 flex max-w-[1100px] items-center justify-between border-t pt-8 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em]"
        style={{ borderColor: LINE, color: "var(--ink-mute)" }}
      >
        <span>tr1via.com · Live trivia</span>
        <span className="flex gap-6">
          <Link href="/trivia-night" className="text-inherit no-underline hover:underline">
            Home
          </Link>
          <Link href="/pricing" className="text-inherit no-underline hover:underline">
            Pricing
          </Link>
          <Link href="/terms" className="text-inherit no-underline hover:underline">
            Terms
          </Link>
          <Link href="/privacy" className="text-inherit no-underline hover:underline">
            Privacy
          </Link>
        </span>
      </footer>
    </main>
  );
}
