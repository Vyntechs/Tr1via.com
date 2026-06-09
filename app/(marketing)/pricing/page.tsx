// /pricing — the honest money page. Free to host forever; the only paid thing
// is optional AI question-writing at $4.99/mo. Pairs the shared Pricing block
// with an objection-killing FAQ (and FAQPage structured data so the answers can
// surface directly in search).
//
// Hand-written server component (mirrors /trivia-night and /themes): statically
// rendered, fully in the HTML → indexable + share-previewable. Wears two months
// (June pricing, January FAQ) via ThemedSection, echoing the hub's Year Scroll.
//
// Scope guard: markets the product, doesn't modify it. Links only to existing
// routes (/login to host, /trivia-night, /themes, /privacy).

import type { Metadata } from "next";
import Link from "next/link";
import { ThemedSection } from "@/components/marketing/ThemedSection";
import { Pricing } from "@/components/marketing/Pricing";
import { Faq, FAQ_ITEMS } from "@/components/marketing/Faq";

const TITLE = "Pricing — free to host";
const SOCIAL_TITLE = `${TITLE} · TR1VIA`;
const DESCRIPTION =
  "TR1VIA is free to host: unlimited games, unlimited players, no per-night fee. The only paid option is AI question-writing at $4.99/month, cancel anytime. No app for players, no hardware.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://tr1via.com/pricing" },
  keywords: [
    "trivia hosting price",
    "free trivia night software",
    "trivia app pricing",
    "trivia night app cost",
    "free live trivia",
  ],
  openGraph: {
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
    type: "website",
    url: "https://tr1via.com/pricing",
    siteName: "TR1VIA",
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_TITLE,
    description: DESCRIPTION,
  },
};

// FAQPage structured data, built from the SAME FAQ_ITEMS the page renders.
const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
};

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

export default function PricingPage() {
  return (
    <main className="min-h-[100dvh]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_LD) }}
      />

      <ThemedSection themeKey="june">
        <Header />
        <Pricing />
      </ThemedSection>

      <ThemedSection themeKey="january">
        <Faq />
        <footer
          className="mx-auto flex max-w-[760px] items-center justify-between px-6 pb-12 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em]"
          style={{ color: "var(--ink-mute)" }}
        >
          <span>tr1via.com · Live trivia</span>
          <span className="flex gap-6">
            <Link href="/trivia-night" className="text-inherit no-underline hover:underline">Home</Link>
            <Link href="/themes" className="text-inherit no-underline hover:underline">Themes</Link>
            <Link href="/terms" className="text-inherit no-underline hover:underline">Terms</Link>
            <Link href="/privacy" className="text-inherit no-underline hover:underline">Privacy</Link>
          </span>
        </footer>
      </ThemedSection>
    </main>
  );
}
