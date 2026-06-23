// /trivia-night — the PUBLIC marketing landing ("The Year Scroll").
//
// Audience: a stranger who found TR1VIA through Google ("trivia night app for
// bars", "live trivia hosting software", "TriviaMaker alternative"). The root
// page `/` redirects here; players who land here tap "Got a code? Join a game".
//
// Positioning (locked = "A"): sell FREE, live, in-person trivia HOSTING. Hook =
// "everybody plays solo — and nobody can cheat" (per-phone scrambled answers).
//
// THE YEAR SCROLL: the product wears a different theme every month, so the page
// doesn't *describe* that — it *is* that. Each section is a <ThemedSection> that
// paints itself in one month's real palette (inline CSS vars, server-rendered),
// so scrolling tours the calendar. It stays readable with ZERO client JS because
// every section rides its own theme's ink-on-paper (contrast designed-in). The
// <YearScroll> island only adds cross-fades + ambient motion on top.
//
// Scope guard: this page MARKETS the product, it does not modify it. It links
// only to existing routes (/login to host, /join to enter a code, /themes,
// /pricing). No gameplay/host/API/data/theme-engine code is touched — the live
// host's game is untouched. (Enforced by tests/unit/marketing/seo-and-scope.)

import type { Metadata } from "next";
import Link from "next/link";
import { Display, Eyebrow } from "@/components/system";
import { ThemeShowcase } from "@/components/marketing/ThemeShowcase";
import { ThemedSection } from "@/components/marketing/ThemedSection";
import { YearInOneTouch } from "@/components/marketing/YearInOneTouch";
import { YearScroll } from "@/components/marketing/YearScroll";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import { TheMoment } from "@/components/marketing/TheMoment";
import { SegmentCues } from "@/components/marketing/SegmentCues";
import { Pricing } from "@/components/marketing/Pricing";
import { Proof } from "@/components/marketing/Proof";

// Bare title — the root layout's metadata template appends " · TR1VIA".
const TITLE = "Host a live trivia night — free";
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

// Structured data — claims mirror the page copy exactly.
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

const SCREEN = "#0b0b12";
const HERO_PHONES: string[][] = [
  ["Paris", "Lyon", "Rome"],
  ["Rome", "Paris", "Nice"],
  ["Lyon", "Nice", "Paris"],
];

function HeroProduct() {
  return (
    <div
      className="relative w-full max-w-[560px] rounded-3xl p-6"
      style={{ background: "var(--ink)" }}
    >
      <div className="rounded-2xl p-5" style={{ background: SCREEN }}>
        <Eyebrow color="var(--pop)" size={10}>
          Question 4 · Geography
        </Eyebrow>
        <Display size={26} color="#fff" style={{ display: "block", marginTop: 6 }}>
          Which city is the capital of France?
        </Display>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {HERO_PHONES.map((opts, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-xl p-2.5" style={{ background: SCREEN }}>
            {opts.map((o, j) => {
              const correct = o === "Paris";
              return (
                <div
                  key={j}
                  className="rounded-md px-2 py-1.5 text-[11px] font-semibold"
                  style={
                    correct
                      ? { background: "var(--correct)", color: "#0b0b12" }
                      : { background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.8)" }
                  }
                >
                  {o}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[12px] font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>
        Same answer, different spot on every phone.
      </p>
    </div>
  );
}

function Header() {
  return (
    <header className="mx-auto flex max-w-[1140px] items-center justify-between px-6 py-6">
      <Link href="/trivia-night" className="no-underline" aria-label="TR1VIA home">
        <span className="font-[family-name:var(--font-sans)] text-[22px] font-bold tracking-tight text-[color:var(--ink)]">
          TR<span className="font-[family-name:var(--font-mono)] text-accent">1</span>VIA
        </span>
      </Link>
      <Link
        href="/login"
        className="rounded-full px-4 py-2 font-[family-name:var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink)] no-underline"
        style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
      >
        Host · Sign in →
      </Link>
    </header>
  );
}

function Hero() {
  return (
    <>
      <Header />
      <div className="mx-auto grid max-w-[1140px] items-center gap-12 px-6 pb-16 pt-8 sm:pt-14 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <Eyebrow color="var(--accent)" size={12}>
            Free to host · unlimited players
          </Eyebrow>
          <Display
            size="clamp(44px, 7vw, 84px)"
            tracking={-0.04}
            style={{ display: "block", marginTop: 18 }}
          >
            Everybody plays solo.
            <br />
            <span style={{ color: "var(--accent)" }}>Nobody can cheat.</span>
          </Display>
          <p className="mt-7 max-w-[560px] text-[18px] leading-relaxed" style={{ color: "var(--ink-mid)" }}>
            One question on the big screen. Every phone shuffles the four answers
            into its own order &mdash; so shouting &ldquo;it&rsquo;s number three!&rdquo;
            means nothing. You run the show; we handle the rest.
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
              className="rounded-2xl px-7 py-4 text-[16px] font-semibold text-[color:var(--ink)] no-underline"
              style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
            >
              Got a code? Join a game
            </Link>
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">
          <HeroProduct />
        </div>
      </div>
    </>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <Eyebrow color="var(--accent)" size={13} style={{ marginTop: 2, minWidth: 28 }}>
        {n}
      </Eyebrow>
      <div>
        <h3 className="text-[18px] font-semibold leading-snug text-[color:var(--ink)]">{title}</h3>
        <p className="mt-1 text-[15px] leading-relaxed" style={{ color: "var(--ink-mid)" }}>
          {body}
        </p>
      </div>
    </li>
  );
}

function HowItWorks() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-24 sm:py-28">
      <Eyebrow color="var(--accent)" size={12}>
        How it works in one night
      </Eyebrow>
      <ol className="mt-8 grid gap-x-12 gap-y-10 sm:grid-cols-2">
        <Step n="01" title="Pick your categories" body="Type your own questions, or let TR1VIA write a whole category for you in seconds. Any topic, fully yours." />
        <Step n="02" title="Players join from their seats" body="They scan a code on the screen — no app to download, no sign-up. They're in within seconds." />
        <Step n="03" title="You run the board off the TV" body="Tap a question. The whole room sees it at once and a 20-second timer starts. You set the pace." />
        <Step n="04" title="Everyone answers alone" body="The four answers are shuffled on every single phone, so shouting “it’s number three!” means nothing." />
      </ol>
    </div>
  );
}

function Diff({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--line)" }}>
      <h3 className="text-[18px] font-bold leading-snug text-[color:var(--ink)]">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--ink-mid)" }}>
        {body}
      </p>
    </div>
  );
}

function WhyDifferent() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-24 sm:py-28">
      <Eyebrow color="var(--accent)" size={12}>
        Why it&rsquo;s different
      </Eyebrow>
      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <Diff title="Solo, never teams" body="Even a table of nine each plays for themselves. No shared answer sheets, no one strong player carrying the table." />
        <Diff title="Cheating doesn’t work" body="Every phone shows the four answers in a different order. Calling out a number helps no one — you read your own screen." />
        <Diff title="Built for a real room" body="Your laptop drives the venue TV; players use the phones already in their pockets. No buzzers, no gear to haul in." />
        <Diff title="It looks the part" body="Real-time, fast, and genuinely beautiful on the big screen — a long way from a slideshow of questions." />
      </div>
    </div>
  );
}

function FinalCTA() {
  return (
    <div className="mx-auto max-w-[1140px] px-6">
      <div className="py-28 text-center">
        <Display size="clamp(34px, 6vw, 64px)" style={{ display: "block" }}>
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
      </div>
      <footer
        className="flex items-center justify-between border-t py-8 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em]"
        style={{ borderColor: "var(--line)", color: "var(--ink-mute)" }}
      >
        <span>tr1via.com · Live trivia</span>
        <span className="flex gap-6">
          <Link href="/pricing" className="text-inherit no-underline hover:underline">Pricing</Link>
          <Link href="/themes" className="text-inherit no-underline hover:underline">Themes</Link>
          <Link href="/terms" className="text-inherit no-underline hover:underline">Terms</Link>
          <Link href="/privacy" className="text-inherit no-underline hover:underline">Privacy</Link>
        </span>
      </footer>
    </div>
  );
}

export default function TriviaNightPage() {
  return (
    <main className="min-h-[100dvh]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <YearScroll />

      <YearInOneTouch ssrThemeKey={resolveTheme(null, null)}>
        <Hero />
      </YearInOneTouch>

      <ThemedSection themeKey="july">
        <TheMoment />
      </ThemedSection>

      <ThemedSection themeKey="august">
        <HowItWorks />
      </ThemedSection>

      <ThemedSection themeKey="october">
        <SegmentCues />
      </ThemedSection>

      <ThemedSection themeKey="december">
        <WhyDifferent />
      </ThemedSection>

      <ThemedSection themeKey="january">
        <div className="mx-auto max-w-[1100px] px-6 py-20">
          <ThemeShowcase variant="teaser" />
        </div>
      </ThemedSection>

      <ThemedSection themeKey="april">
        <Proof quote={null} />
      </ThemedSection>

      <ThemedSection themeKey="june">
        <Pricing />
      </ThemedSection>

      <ThemedSection themeKey="june">
        <FinalCTA />
      </ThemedSection>
    </main>
  );
}
