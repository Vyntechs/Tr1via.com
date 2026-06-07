// /trivia-night — the PUBLIC marketing landing.
//
// Audience: a stranger who found TR1VIA through Google ("trivia night app for
// bars", "live trivia hosting software", "TriviaMaker alternative"). The root
// page `/` is NOT this — it's the player room-code entry (90% of traffic, host
// points at the TV). So discovery traffic needs its own indexable home: here.
//
// Positioning (locked = "A"): sell FREE, live, in-person trivia HOSTING. The
// differentiator hook is "everybody plays solo — and nobody can cheat" (per-phone
// scrambled answers). Free hosting is the wedge; AI question writing is the upsell.
//
// Why a hand-written SERVER component (mirrors app/privacy/page.tsx):
//  - Statically rendered + fully in the HTML → indexable, fast, share-previewable.
//  - Zero new deps, zero client JS. Inherits daylight theme tokens (paper/ink/
//    accent) from the root layout's ThemeProvider.
//  - Uses the design-system <Display>/<Eyebrow> (both server-safe). The <Wordmark>
//    component is "use client" (reads theme via context), so the mark is hand-set
//    here exactly as the privacy page does.
//
// Scope guard: this page MARKETS the product, it does not modify it. It links only
// to existing routes (/login to host, /join to enter a code, /themes for the theme
// gallery). No gameplay, host, API, or data code is touched. Billing/signup
// plumbing is the separate free/paid pivot.

import type { Metadata } from "next";
import Link from "next/link";
import { Display, Eyebrow } from "@/components/system";
import { ThemeShowcase } from "@/components/marketing/ThemeShowcase";

// Bare title — the root layout's metadata template appends " · TR1VIA", so the
// browser tab reads "Host a live trivia night — free · TR1VIA" (brand once, not twice).
const TITLE = "Host a live trivia night — free";
// OG/Twitter/JSON-LD don't go through the layout template, so they carry the brand explicitly.
const SOCIAL_TITLE = `${TITLE} · TR1VIA`;
const DESCRIPTION =
  "Run a live trivia night where everyone plays solo on their own phone and nobody can cheat. Free to host, unlimited players, no per-night fee. You pick the categories; TR1VIA runs the room.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://tr1via.com/trivia-night" },
  keywords: [
    "trivia night app",
    "live trivia hosting",
    "trivia app for bars",
    "jeopardy style trivia game",
    "trivia game players use phones",
    "free trivia night software",
    "TriviaMaker alternative",
  ],
  openGraph: {
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "https://tr1via.com/trivia-night",
    siteName: "TR1VIA",
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
  },
};

// Structured data so Google/socials understand what this is: a free trivia-night
// hosting app with a paid AI add-on. Claims here mirror the page copy exactly.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "TR1VIA",
  applicationCategory: "GameApplication",
  operatingSystem: "Web",
  description: DESCRIPTION,
  url: "https://tr1via.com/trivia-night",
  offers: [
    {
      "@type": "Offer",
      name: "Host for free",
      price: "0",
      priceCurrency: "USD",
      description: "Unlimited games, unlimited players, no per-night fee.",
    },
    {
      "@type": "Offer",
      name: "Trivia Nerd — AI question writing",
      price: "4.99",
      priceCurrency: "USD",
      description: "Let TR1VIA write a whole category for you. Cancel anytime.",
    },
  ],
};

// Daylight theme tokens that aren't part of Tailwind's --color-* set are read
// straight from CSS vars (set by the root layout for data-theme="daylight").
const INK_MID = "var(--ink-mid)";
const LINE = "var(--line)";
const SURFACE = "var(--surface)";

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <Eyebrow color="var(--accent)" size={13} style={{ marginTop: 2, minWidth: 28 }}>
        {n}
      </Eyebrow>
      <div>
        <h3 className="text-[17px] font-semibold leading-snug text-ink">{title}</h3>
        <p className="mt-1 text-[15px] leading-relaxed" style={{ color: INK_MID }}>
          {body}
        </p>
      </div>
    </li>
  );
}

function Differentiator({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-2xl p-6"
      style={{ background: SURFACE, border: `1px solid ${LINE}` }}
    >
      <h3 className="text-[18px] font-bold leading-snug text-ink">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: INK_MID }}>
        {body}
      </p>
    </div>
  );
}

export default function TriviaNightPage() {
  return (
    <main className="min-h-[100dvh] bg-paper px-6 pb-24 text-ink sm:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      {/* Header — wordmark + the host sign-in chip (hand-set; Wordmark is client-only) */}
      <header className="mx-auto flex max-w-[1040px] items-center justify-between py-6">
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
      <section className="mx-auto max-w-[1040px] pt-10 sm:pt-20">
        <Eyebrow color="var(--accent)" size={12}>
          FREE TO HOST · UNLIMITED PLAYERS
        </Eyebrow>
        <Display
          size="clamp(48px, 9vw, 104px)"
          color="var(--ink)"
          tracking={-0.04}
          style={{ display: "block", marginTop: 18, maxWidth: 920 }}
        >
          Everybody plays solo.
          <br />
          <span style={{ color: "var(--accent)" }}>Nobody can cheat.</span>
        </Display>
        <p
          className="mt-7 max-w-[620px] text-[18px] leading-relaxed"
          style={{ color: INK_MID }}
        >
          TR1VIA is a live trivia night where every person plays on their own
          phone, reads off one big screen, and literally can&apos;t copy the
          table next to them. You run the show — we handle the rest.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            data-testid="marketing-cta-host"
            className="rounded-2xl bg-accent px-7 py-4 text-[16px] font-bold text-white no-underline"
            style={{ boxShadow: "0 14px 30px -10px var(--accent)" }}
          >
            Start hosting — free →
          </Link>
          <Link
            href="/join"
            data-testid="marketing-cta-join"
            className="rounded-2xl px-7 py-4 text-[16px] font-semibold text-ink no-underline"
            style={{ border: `1px solid ${LINE}`, background: SURFACE }}
          >
            Got a code? Join a game
          </Link>
        </div>
      </section>

      {/* How it works in one night */}
      <section className="mx-auto mt-24 max-w-[1040px]">
        <Eyebrow color={INK_MID} size={12}>
          HOW IT WORKS IN ONE NIGHT
        </Eyebrow>
        <ol className="mt-8 grid gap-7 sm:grid-cols-2">
          <Step
            n="01"
            title="Pick your categories"
            body="Type your own questions, or let TR1VIA write a whole category for you in seconds. Any topic, fully yours."
          />
          <Step
            n="02"
            title="Players join from their seats"
            body="They scan a code on the screen — no app to download, no sign-up. They're in within seconds."
          />
          <Step
            n="03"
            title="You run the board off the TV"
            body="Tap a question. The whole room sees it at once and a 20-second timer starts. You set the pace."
          />
          <Step
            n="04"
            title="Everyone answers alone"
            body="The four answers are shuffled on every single phone, so shouting “it's number three!” means nothing. Right and wrong reveal for the whole room at the same moment."
          />
        </ol>
      </section>

      {/* Why it's different */}
      <section className="mx-auto mt-24 max-w-[1040px]">
        <Eyebrow color={INK_MID} size={12}>
          WHY IT&apos;S DIFFERENT
        </Eyebrow>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <Differentiator
            title="Solo, never teams"
            body="Even a table of nine each plays for themselves. No shared answer sheets, no one strong player carrying the table."
          />
          <Differentiator
            title="Cheating doesn't work"
            body="Every phone shows the four answers in a different order. Calling out a number helps no one — you have to actually read your own screen."
          />
          <Differentiator
            title="Built for a real room"
            body="Your laptop drives the venue TV; players use the phones already in their pockets. No buzzers, no extra gear to haul in."
          />
          <Differentiator
            title="It looks the part"
            body="Real-time, fast, and genuinely beautiful on the big screen — a long way from a slideshow of questions."
          />
        </div>
      </section>

      {/* A new look every month — the theme showcase teaser → full /themes gallery */}
      <ThemeShowcase variant="teaser" />

      {/* Free vs AI upsell */}
      <section className="mx-auto mt-24 max-w-[1040px]">
        <div
          className="rounded-3xl p-8 sm:p-12"
          style={{ background: SURFACE, border: `1px solid ${LINE}` }}
        >
          <Display size="clamp(28px, 4vw, 40px)" color="var(--ink)" style={{ display: "block" }}>
            Free forever to host.
          </Display>
          <p className="mt-4 max-w-[640px] text-[17px] leading-relaxed" style={{ color: INK_MID }}>
            Unlimited games, unlimited players, no per-night fee — hosting never
            costs you anything. Want TR1VIA to write the questions for you? Add AI
            category generation for <span className="font-semibold text-ink">$4.99/month</span>,
            cancel anytime. That&apos;s the only thing we ever charge for.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto mt-24 max-w-[1040px] text-center">
        <Display size="clamp(34px, 6vw, 64px)" color="var(--ink)" style={{ display: "block" }}>
          Your next trivia night starts here.
        </Display>
        <div className="mt-9 flex justify-center">
          <Link
            href="/login"
            className="rounded-2xl bg-accent px-8 py-4 text-[16px] font-bold text-white no-underline"
            style={{ boxShadow: "0 14px 30px -10px var(--accent)" }}
          >
            Start hosting — free →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="mx-auto mt-24 flex max-w-[1040px] items-center justify-between border-t pt-8 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em]"
        style={{ borderColor: LINE, color: "var(--ink-mute)" }}
      >
        <span>tr1via.com · Live trivia</span>
        <Link href="/privacy" className="text-inherit no-underline hover:underline">
          Privacy
        </Link>
      </footer>
    </main>
  );
}
