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
import { Display, Eyebrow, Wordmark } from "@/components/system";
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

const HEATHER_QUOTE =
  "I love the new Tr1via platform. It has cut my time in half creating games. I am impressed how it adapts to my type of questions the more I use it.";
const HEATHER_ATTRIBUTION = "Heather, weekly trivia host";

const SCREEN = "#070812";
const SCREEN_SOFT = "#111321";
const SURFACE_PHONES: { label: string; answers: string[] }[] = [
  { label: "Player 1 phone", answers: ["Paris", "Lyon", "Rome", "Nice"] },
  { label: "Player 2 phone", answers: ["Rome", "Nice", "Paris", "Lyon"] },
  { label: "Player 3 phone", answers: ["Lyon", "Paris", "Nice", "Rome"] },
];
const ROOM_ROLES = [
  {
    title: "Host laptop",
    body: "Tap reveal, run the timer, and keep control of the night.",
  },
  {
    title: "Venue TV",
    body: "Everyone sees the same question, board, timer, and payoff.",
  },
  {
    title: "Player phones",
    body: "Each person gets a private answer card with shuffled choices.",
  },
  {
    title: "No extra gear",
    body: "No app download, buzzers, tablets, or paper answer sheets.",
  },
];

function MiniAnswer({ answer }: { answer: string }) {
  const correct = answer === "Paris";
  return (
    <div
      className="rounded-md px-2 py-1.5 text-[10px] font-bold leading-none"
      style={
        correct
          ? { background: "var(--correct)", color: SCREEN }
          : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.72)" }
      }
    >
      {answer}
    </div>
  );
}

function SurfacePhone({ label, answers }: { label: string; answers: string[] }) {
  return (
    <div
      className="rounded-lg p-2"
      style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.11)" }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-[family-name:var(--font-mono)] text-[8px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.5)" }}>
          {label}
        </span>
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--correct)" }} />
      </div>
      <div className="grid gap-1.5">
        {answers.map((answer) => (
          <MiniAnswer key={answer} answer={answer} />
        ))}
      </div>
    </div>
  );
}

function SurfaceChip({ n, title, value }: { n: string; title: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.07)" }}>
      <p className="font-[family-name:var(--font-mono)] text-[9px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.48)" }}>
        {n} · {title}
      </p>
      <p className="text-[13px] font-bold text-white">{value}</p>
    </div>
  );
}

function LandingSurfaceStage() {
  return (
    <div
      data-testid="landing-surface-stage"
      aria-label="Diagram showing one host laptop controlling the venue TV and every player's phone"
      className="relative w-full max-w-[650px] overflow-hidden rounded-lg p-3 sm:p-5"
      style={{
        background: `linear-gradient(140deg, var(--ink), ${SCREEN_SOFT})`,
        boxShadow: "0 28px 70px -36px var(--ink)",
      }}
    >
      <div
        className="absolute left-10 top-8 h-24 w-48 rounded-full blur-3xl"
        style={{ background: "var(--accent)", opacity: 0.42 }}
      />
      <div
        className="absolute bottom-8 right-10 h-20 w-44 rounded-full blur-3xl"
        style={{ background: "var(--pop)", opacity: 0.24 }}
      />

      <div
        className="relative rounded-lg p-3 sm:p-4"
        style={{ background: "rgba(7,8,18,0.78)", border: "1px solid rgba(255,255,255,0.14)" }}
      >
        <div className="flex items-center justify-between gap-4">
          <Eyebrow color="var(--pop)" size={10}>
            What the room sees
          </Eyebrow>
          <span className="rounded-full px-3 py-1 font-[family-name:var(--font-mono)] text-[9px] font-bold uppercase text-white" style={{ background: "rgba(255,255,255,0.1)" }}>
            one host controls it
          </span>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1.14fr_0.86fr]">
          <section className="rounded-lg p-4" style={{ background: SCREEN, border: "1px solid rgba(255,255,255,0.1)" }}>
            <div className="flex items-center justify-between">
              <Eyebrow color="var(--correct)" size={9}>
                Big screen in the room
              </Eyebrow>
              <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold uppercase" style={{ color: "rgba(255,255,255,0.44)" }}>
                00:18
              </span>
            </div>
            <Display
              size={31}
              color="#fff"
              tracking={0}
              style={{ display: "block", lineHeight: 1.03, marginTop: 12 }}
            >
              Which city is the capital of France?
            </Display>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {["Paris", "Lyon", "Rome", "Nice"].map((answer) => (
                <div
                  key={answer}
                  className="rounded-md px-3 py-2 text-[12px] font-bold"
                  style={
                    answer === "Paris"
                      ? { background: "var(--correct)", color: SCREEN }
                      : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.78)" }
                  }
                >
                  {answer}
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-3">
            <section className="rounded-lg p-4" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)" }}>
              <Eyebrow color="var(--pop)" size={9}>
                Host laptop
              </Eyebrow>
              <div className="mt-3 flex items-end justify-between gap-3">
                <div>
                  <p className="text-[22px] font-black leading-none text-white">Tap once to reveal</p>
                  <p className="mt-1 text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.58)" }}>
                    TV and phones move together in the room.
                  </p>
                </div>
                <span className="rounded-md px-2.5 py-2 font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase" style={{ background: "var(--accent)", color: "#fff" }}>
                  live
                </span>
              </div>
            </section>

            <section className="grid grid-cols-3 gap-2">
              {SURFACE_PHONES.map((phone) => (
                <SurfacePhone key={phone.label} label={phone.label} answers={phone.answers} />
              ))}
            </section>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <SurfaceChip n="1" title="Host" value="Taps reveal" />
          <SurfaceChip n="2" title="TV" value="Room watches" />
          <SurfaceChip n="3" title="Phones" value="Players answer" />
        </div>
      </div>
    </div>
  );
}

function RoleCard({ title, body }: { title: string; body: string }) {
  return (
    <li
      className="rounded-lg px-3 py-2.5 sm:py-3"
      style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
    >
      <h3 className="text-[13px] font-black leading-tight text-[color:var(--ink)]">{title}</h3>
      <p className="mt-1 text-[11px] font-semibold leading-snug sm:text-[12px]" style={{ color: "var(--ink-mid)" }}>
        {body}
      </p>
    </li>
  );
}

function Header() {
  return (
    <header className="mx-auto flex max-w-[1140px] items-center justify-between px-6 py-6">
      <Link href="/trivia-night" className="no-underline" aria-label="TR1VIA home">
        <span data-testid="tr1via-wordmark">
          <Wordmark
            size={26}
            weight={800}
            tracking={-0.018}
            style={{ display: "inline-flex" }}
          />
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
      <div className="mx-auto grid max-w-[1180px] items-center gap-12 px-6 pb-12 pt-8 sm:pt-14 lg:grid-cols-[0.92fr_1.08fr]">
        <div>
          <Eyebrow color="var(--accent)" size={12}>
            Free live trivia hosting
          </Eyebrow>
          <h1 className="mt-5">
            <Display
              size="clamp(42px, 6vw, 74px)"
              tracking={0}
              style={{ display: "block", lineHeight: 0.96 }}
            >
              Host live trivia. Players answer on phones.
            </Display>
          </h1>
          <p className="mt-5 max-w-[590px] text-[17px] leading-relaxed" style={{ color: "var(--ink-mid)" }}>
            TR1VIA puts questions on the big screen, gives every player a
            private phone answer card, and lets the host run the night from one
            laptop. Answers shuffle so nobody can cheat.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
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
          <p className="mt-4 font-[family-name:var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--ink-mid)" }}>
            One press · three surfaces · answers shuffled per phone
          </p>
          <div
            data-testid="landing-role-map"
            className="mt-5 rounded-lg p-3"
            style={{ background: "color-mix(in srgb, var(--surface) 72%, transparent)", border: "1px solid var(--line)" }}
          >
            <p className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "var(--accent)" }}>
              The whole setup
            </p>
            <ul className="mt-3 grid grid-cols-2 gap-2">
              {ROOM_ROLES.map((role) => (
                <RoleCard key={role.title} title={role.title} body={role.body} />
              ))}
            </ul>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {["For venues", "For weekly hosts", "Ready for a live room"].map((label) => (
              <span
                key={label}
                className="rounded-full px-3 py-1.5 text-[12px] font-bold"
                style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)" }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex justify-center lg:justify-end">
          <LandingSurfaceStage />
        </div>
      </div>

      <HeatherProofBar />
    </>
  );
}

function HeatherProofBar() {
  return (
    <div className="mx-auto max-w-[1140px] px-6 py-7">
      <div
        className="grid gap-4 border-y py-5 sm:grid-cols-[0.34fr_1fr] sm:items-center"
        style={{ borderColor: "var(--line)" }}
      >
        <Eyebrow color="var(--accent)" size={11}>
          First live host proof
        </Eyebrow>
        <p className="max-w-[780px] text-[17px] font-semibold leading-relaxed" style={{ color: "var(--ink)" }}>
          Heather, weekly trivia host, cut game creation time in half after
          moving her live night onto TR1VIA.
        </p>
      </div>
    </div>
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

function BuildNight() {
  return (
    <div className="mx-auto grid max-w-[1120px] items-center gap-10 px-6 py-24 sm:py-28 lg:grid-cols-[0.9fr_1.1fr]">
      <div>
        <Eyebrow color="var(--accent)" size={12}>
          Build a night in minutes
        </Eyebrow>
        <Display
          size="clamp(36px, 5vw, 58px)"
          tracking={0}
          style={{ display: "block", lineHeight: 1, marginTop: 16 }}
        >
          Bring the idea.
          <br />
          Leave with the board.
        </Display>
        <p className="mt-6 max-w-[520px] text-[17px] leading-relaxed" style={{ color: "var(--ink-mid)" }}>
          Type the vibe for the room, keep what hits, edit what needs your
          voice, then walk into showtime with a TV-ready game.
        </p>
      </div>

      <div
        className="rounded-lg p-4 sm:p-5"
        style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow color="var(--accent)" size={10}>
            Host builder
          </Eyebrow>
          <span className="rounded-md px-3 py-1.5 font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase" style={{ background: "var(--accent)", color: "#fff" }}>
            ready for review
          </span>
        </div>

        <div className="mt-5 grid gap-3">
          {[
            ["01", "Pick the room", "Sports bar regulars, birthday party, office crowd, or your own strange theme."],
            ["02", "Shape the questions", "Use AI to draft faster, then review every clue before it goes live."],
            ["03", "Run the show", "The board, TV, host phone, and player phones stay in one shared moment."],
          ].map(([n, title, body]) => (
            <div
              key={n}
              className="grid gap-3 rounded-lg p-4 sm:grid-cols-[46px_1fr]"
              style={{ background: "var(--paper)", border: "1px solid var(--line)" }}
            >
              <span className="font-[family-name:var(--font-mono)] text-[13px] font-black" style={{ color: "var(--accent)" }}>
                {n}
              </span>
              <div>
                <h3 className="text-[18px] font-black leading-tight text-[color:var(--ink)]">{title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed" style={{ color: "var(--ink-mid)" }}>
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
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

      <ThemedSection themeKey="september">
        <BuildNight />
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
        <Proof quote={{ text: HEATHER_QUOTE, attribution: HEATHER_ATTRIBUTION }} />
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
