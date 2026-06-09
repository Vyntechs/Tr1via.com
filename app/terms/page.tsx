// PUBLISHED Terms of Service — /terms.
//
// This page is the CANONICAL, legally-operative Terms of Service. It is written
// to match what the TR1VIA code actually does as of the effective date below —
// free unlimited hosting, an optional paid "Trivia Nerd" AI add-on billed
// through Stripe, players who never sign up or pay. Keep every claim true to the
// current implementation, and keep this file in sync with the privacy policy
// (app/privacy/page.tsx) so the two never contradict each other.
//
// The plain-text mirror at docs/legal/terms-of-service.md must be kept in sync
// with this file.
//
// Why a hand-written server component (no markdown lib): mirrors the privacy
// page — zero new deps, renders statically, inherits the daylight theme tokens
// (paper/ink/accent) from the root layout's ThemeProvider. No client JS needed.
//
// NOT a substitute for an attorney's review. Residual decisions (refund policy,
// liability cap, age requirement) were set to sensible small-business defaults
// and should get a one-time legal pass before relying on them in a dispute.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The agreement between you and Vyntechs for using TR1VIA — free live-trivia hosting, the optional paid Trivia Nerd AI add-on, billing, acceptable use, and your rights.",
};

const EFFECTIVE = "June 9, 2026";

export default function TermsOfServicePage() {
  return (
    <main className="mx-auto max-w-[760px] px-6 py-16 text-ink sm:px-8">
      <header className="mb-12 border-b border-ink/10 pb-8">
        <Link
          href="/"
          className="text-[13px] font-semibold uppercase tracking-wider text-accent no-underline hover:underline"
        >
          TR1VIA
        </Link>
        <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-bold leading-tight">
          Terms of Service
        </h1>
        <p className="mt-3 text-sm text-ink/60">
          Effective {EFFECTIVE} · Last updated {EFFECTIVE}
        </p>
        <p className="mt-6 text-[15px] leading-relaxed text-ink/80">
          These Terms of Service (the “Terms”) are the agreement between you and
          Vyntechs for using TR1VIA at tr1via.com. They explain what TR1VIA is,
          what you can and can’t do, how the optional paid plan and billing work,
          and the legal terms that apply. They are written to be read, not to hide
          anything.
        </p>
        <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
          TR1VIA is operated by Vyntechs, a sole proprietorship based in Cleburne,
          Texas, United States (“Vyntechs”, “we”, “us”, “our”). Mailing address:
          1712 Raylene Dr, Cleburne, TX 76033. Questions:{" "}
          <a href="mailto:support@vyntechs.com" className="text-accent">
            support@vyntechs.com
          </a>
          .
        </p>
        <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
          <B>
            By using TR1VIA — whether you host a game or join one as a player —
            you agree to these Terms and to our{" "}
            <Link href="/privacy" className="text-accent no-underline hover:underline">
              Privacy Policy
            </Link>
            . If you do not agree, do not use TR1VIA.
          </B>
        </p>
      </header>

      <Section title="Who these Terms cover">
        <P>There are two kinds of people who use TR1VIA, and the Terms apply to both:</P>
        <UL>
          <li>
            <B>Players</B> — anyone who joins a game by entering a 6-character room
            code on their phone. Players do not create an account, do not pay, and
            are not asked to confirm anything beyond joining. You may type a
            display name so others can see your score. By joining a game you agree
            to these Terms and to our Privacy Policy.
          </li>
          <li>
            <B>Hosts</B> — the venue staff or organizers who run games. Hosts have
            an account and are responsible for the games they create, the content
            they add, and how they use TR1VIA at their venue.
          </li>
        </UL>
      </Section>

      <Section title="What TR1VIA is">
        <P>
          TR1VIA is a tool for running live, in-person trivia. Hosting is free and
          unlimited: unlimited games, unlimited players, and no per-night fee. You
          can create games, write your own questions, run a game for a room full of
          players on their phones, and show scores and recaps.
        </P>
        <P>
          The <B>only</B> paid feature is AI help. Writing your own questions by
          hand is always free. If you want TR1VIA to generate questions and
          categories for you, or attach images to questions automatically, that is
          the optional <B>“Trivia Nerd”</B> plan described under “Paid plans and
          billing” below. Everything else stays free.
        </P>
      </Section>

      <Section title="Host accounts and eligibility">
        <P>
          To host, you must be at least 18 years old and able to form a binding
          contract. You are responsible for the information on your account, for
          keeping your sign-in secure, and for everything that happens under your
          account. Tell us at{" "}
          <a href="mailto:support@vyntechs.com" className="text-accent">
            support@vyntechs.com
          </a>{" "}
          if you think someone has used your account without permission.
        </P>
        <P>
          One account is for one host or organization. Don’t share an account in a
          way meant to get around the paid plan, and don’t create accounts to
          abuse free trials or promotions.
        </P>
      </Section>

      <Section title="Acceptable use">
        <P>When you use TR1VIA, you agree not to:</P>
        <UL>
          <li>break the law, infringe someone’s intellectual property, or violate anyone’s privacy or other rights;</li>
          <li>
            create, upload, or display content that is unlawful, harassing,
            hateful, defamatory, sexually explicit, or otherwise inappropriate for
            a general-audience venue;
          </li>
          <li>interfere with, overload, probe, or try to break the security of the service;</li>
          <li>reverse engineer, scrape, copy, or resell the service or its content except as the law allows;</li>
          <li>use the service to send spam or to deceive or harm other users or your players.</li>
        </UL>
        <P>
          As a host, you are responsible for the questions and other content you
          create or choose to display, and for running games appropriately for the
          people in your venue, including any minors who may be present. We may
          remove content or suspend accounts that break these Terms.
        </P>
      </Section>

      <Section title="AI-generated content">
        <P>
          The paid plan uses AI (provided by Anthropic) to generate trivia
          questions and categories from the topic and instructions you type, and it
          can attach images from Pexels. <B>AI-generated questions and answers can
          be wrong, out of date, biased, or inappropriate.</B> You are responsible
          for reviewing anything the AI generates before you use it in a game. We
          don’t guarantee that AI-generated content is accurate, original, or fit
          for any particular purpose.
        </P>
        <P>
          Images are provided by Pexels and are subject to the{" "}
          <a
            href="https://www.pexels.com/license/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent"
          >
            Pexels license
          </a>
          . You are responsible for using any image appropriately.
        </P>
      </Section>

      <Section title="Paid plans and billing">
        <H3>The Trivia Nerd plan</H3>
        <P>
          “Trivia Nerd” is an optional subscription that turns on AI question and
          category generation and AI image attachment for your account. It costs{" "}
          <B>$4.99 per month</B> or <B>$39.99 per year</B> (in U.S. dollars). The
          subscription <B>renews automatically</B> at the end of each billing
          period — monthly or yearly — until you cancel.
        </P>
        <H3>How billing works</H3>
        <P>
          Payments are processed by <B>Stripe</B>. When you subscribe, you enter
          your payment details with Stripe and your use is also subject to{" "}
          <a
            href="https://stripe.com/legal/consumer"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent"
          >
            Stripe’s terms
          </a>
          . We do not see or store your full card number. Stripe emails you a
          receipt for each payment.
        </P>
        <H3>Fair-use limit on AI</H3>
        <P>
          The Trivia Nerd plan includes a generous monthly limit on AI
          generations. A normal host will not reach it. We may limit, slow, or
          pause AI generation for an account that uses far more than normal use, to
          keep the service sustainable for everyone.
        </P>
        <H3>Cancelling</H3>
        <P>
          You can cancel anytime from the <B>“Manage subscription”</B> button in
          your dashboard, which opens Stripe’s customer portal. When you cancel,
          your paid AI features stay on until the end of the period you’ve already
          paid for, and then turn off. Hosting stays free either way.
        </P>
        <H3>Refunds</H3>
        <P>
          Payments already made are non-refundable except where the law requires
          otherwise. Cancelling stops future charges; it does not refund the
          current period.
        </P>
        <H3>Failed payments</H3>
        <P>
          If a renewal payment fails, Stripe may retry it for a short time. If it
          stays unpaid, your paid AI features turn off until payment succeeds. We
          will never interrupt a game already in progress because of a billing
          issue.
        </P>
        <H3>Price and plan changes</H3>
        <P>
          We may change prices or what a plan includes. If we change the price of a
          plan you’re on, we’ll give you at least 30 days’ notice before it applies
          to your next billing period, and you can cancel before then if you don’t
          agree.
        </P>
        <H3>Free and comped accounts</H3>
        <P>
          We may grant some accounts free or discounted access to AI features at
          our discretion (for example, our earliest hosts). Free access is a
          courtesy, not a paid entitlement, and we may change or end it with
          reasonable notice — except where we’ve separately agreed otherwise with
          you in writing.
        </P>
      </Section>

      <Section title="Players">
        <P>
          Players never create an account, never pay, and are never asked to
          confirm anything beyond joining a game. The only information a player
          provides is an optional display name; everything else is described in our{" "}
          <Link href="/privacy" className="text-accent no-underline hover:underline">
            Privacy Policy
          </Link>
          . Players agree to the acceptable-use rules above — for example, not
          choosing an offensive display name.
        </P>
      </Section>

      <Section title="Your content and our content">
        <P>
          <B>Your content.</B> The questions, categories, and other material you
          create stay yours. By using TR1VIA you give us the limited permission we
          need to host, store, display, and process your content so we can run the
          service for you and your players. You’re responsible for having the right
          to use any content you add.
        </P>
        <P>
          <B>Our content.</B> TR1VIA — the software, design, branding, and the
          look and feel of the service — belongs to Vyntechs. These Terms don’t
          give you any right to copy, resell, or reuse it except to use the service
          as intended.
        </P>
      </Section>

      <Section title="Third-party services">
        <P>
          TR1VIA relies on a small number of service providers to work: Vercel
          (hosting), Supabase (database, accounts, and the live game connection),
          Pexels (images), Anthropic (AI generation), and Stripe (payments). Your
          use of TR1VIA may also be subject to those providers’ terms, and what
          each one receives is described in our{" "}
          <Link href="/privacy" className="text-accent no-underline hover:underline">
            Privacy Policy
          </Link>
          .
        </P>
      </Section>

      <Section title="Service availability and disclaimers">
        <P>
          We work hard to keep TR1VIA running, but it is provided <B>“as is” and
          “as available.”</B> We don’t promise it will always be available,
          uninterrupted, error-free, or that AI-generated content will be accurate.
          To the fullest extent allowed by law, we disclaim all warranties, whether
          express or implied, including any implied warranties of merchantability,
          fitness for a particular purpose, and non-infringement.
        </P>
        <P>
          You are responsible for your own event — your venue, your players, your
          prizes, and how you run trivia night. TR1VIA is a tool to help you run
          the game; it is not responsible for the outcome of your event.
        </P>
      </Section>

      <Section title="Limitation of liability">
        <P>
          To the fullest extent allowed by law, Vyntechs will not be liable for any
          indirect, incidental, special, consequential, or punitive damages, or for
          lost profits, revenue, data, or goodwill, arising out of or relating to
          your use of TR1VIA.
        </P>
        <P>
          Our total liability for any claim relating to TR1VIA will not exceed the
          greater of (a) the amount you paid us in the 12 months before the event
          giving rise to the claim, or (b) US $100. Some jurisdictions don’t allow
          certain limitations, so some of these may not apply to you.
        </P>
      </Section>

      <Section title="Indemnification">
        <P>
          You agree to defend, indemnify, and hold harmless Vyntechs from claims,
          losses, and expenses (including reasonable legal fees) arising from the
          content you create, your use of TR1VIA, your event, or your violation of
          these Terms or someone else’s rights.
        </P>
      </Section>

      <Section title="Suspension and termination">
        <P>
          You can stop using TR1VIA at any time. We may suspend or end your access
          if you break these Terms, if your use creates a legal or security risk,
          or if we stop offering the service. If we end the service entirely, we’ll
          give hosts reasonable notice where we can. When access ends, the parts of
          these Terms that should reasonably survive — such as content ownership,
          disclaimers, limitation of liability, and indemnification — continue to
          apply.
        </P>
      </Section>

      <Section title="Governing law and disputes">
        <P>
          These Terms are governed by the laws of the State of Texas, without
          regard to its conflict-of-laws rules. Before filing anything formal,
          please contact us at{" "}
          <a href="mailto:support@vyntechs.com" className="text-accent">
            support@vyntechs.com
          </a>{" "}
          so we can try to resolve the issue informally. Any dispute that isn’t
          resolved that way will be handled by the state or federal courts located
          in Texas, and you and we consent to their jurisdiction — except where
          applicable law gives you the right to bring a claim elsewhere.
        </P>
      </Section>

      <Section title="Changes to these Terms">
        <P>
          We may update these Terms. When we make material changes, we’ll update
          the “Last updated” date, post the new version here, and — for hosts,
          where we have an email on file — give notice before the change takes
          effect. Players do not have accounts, so for players the posted Terms are
          the notice. Continuing to use TR1VIA after a change takes effect, once
          you’ve had reasonable notice, means you accept the updated Terms. If
          you’re a host and you don’t agree, contact us before the change applies.
        </P>
      </Section>

      <Section title="Contact us">
        <P>
          Email:{" "}
          <a href="mailto:support@vyntechs.com" className="text-accent">
            support@vyntechs.com
          </a>
          <br />
          Mailing address: Vyntechs, 1712 Raylene Dr, Cleburne, TX 76033
        </P>
      </Section>

      <footer className="mt-14 border-t border-ink/10 pt-6 text-sm text-ink/50">
        <Link href="/" className="text-accent no-underline hover:underline">
          ← Back to TR1VIA
        </Link>
        <span className="px-2 text-ink/30">·</span>
        <Link href="/privacy" className="text-accent no-underline hover:underline">
          Privacy Policy
        </Link>
      </footer>
    </main>
  );
}

/* ---- small presentational helpers (mirror app/privacy/page.tsx) ---- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 font-[family-name:var(--font-display)] text-2xl font-bold leading-snug">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 text-[15px] font-bold text-ink">{children}</h3>;
}

function P({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-[15px] leading-relaxed text-ink/80 ${className}`}>
      {children}
    </p>
  );
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="ml-5 list-disc space-y-2 text-[15px] leading-relaxed text-ink/80 marker:text-ink/40">
      {children}
    </ul>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-ink">{children}</strong>;
}
