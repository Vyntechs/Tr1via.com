// PUBLISHED privacy policy — /privacy.
//
// This page is the CANONICAL, legally-operative privacy notice. It was
// rewritten from the as-delivered draft (docs/legal/privacy-policy-ORIGINAL.md)
// to match what the TR1VIA code actually does — every claim here is true to
// the current implementation as of the effective date below. The plain-text
// mirror at docs/legal/privacy-policy.md must be kept in sync with this file.
//
// Why a hand-written server component (no markdown lib): keeps zero new deps,
// renders statically, and inherits the daylight theme tokens (paper/ink/accent)
// from the root layout's ThemeProvider. No client JS needed.
//
// See docs/legal/privacy-review.md for the audit that drove every change here,
// and for the residual items that need Brandon's decision or a real attorney
// (form an entity/LLC, publish a Terms of Service, build deletion tooling).

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What TR1VIA collects when you play or host live trivia, why, who we share it with, how long we keep it, and your rights.",
};

const EFFECTIVE = "June 1, 2026";

export default function PrivacyPolicyPage() {
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
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-ink/60">
          Effective {EFFECTIVE} · Last updated {EFFECTIVE}
        </p>
        <p className="mt-6 text-[15px] leading-relaxed text-ink/80">
          This policy explains what information TR1VIA collects when you play or
          host live trivia at tr1via.com, why we collect it, who we share it
          with, how long we keep it, and what choices you have. It is written to
          be read, not to hide anything.
        </p>
        <p className="mt-4 text-[15px] leading-relaxed text-ink/80">
          TR1VIA is operated by Vyntechs, based in Cleburne, Texas, United
          States. Mailing address: 1712 Raylene Dr, Cleburne, TX 76033.
          Questions:{" "}
          <a href="mailto:support@vyntechs.com" className="text-accent">
            support@vyntechs.com
          </a>
          .
        </p>
      </header>

      <Section title="Who this policy covers">
        <P>There are two kinds of people who use TR1VIA:</P>
        <UL>
          <li>
            <B>Players</B> — anyone who joins a game by entering a 6-character
            room code on their phone. No account, email, or password is
            required. You may type a display name so others can see your score;
            that name, and a device identifier we set (see “Cookies and your
            device”), are stored with your game data.
          </li>
          <li>
            <B>Hosts</B> — venue staff or organizers who run games. A host signs
            in by entering their email address; our server checks it against the
            list of host accounts and creates a login session. We do not send a
            magic-link or one-time-code email as part of normal sign-in. New
            hosts are added by the operator, who may share a one-time sign-in
            link directly.
          </li>
        </UL>
      </Section>

      <Section title="Children under 13">
        <P>
          TR1VIA is a general-audience trivia service. It is not designed for,
          marketed to, or directed at children under 13, and we do not knowingly
          collect personal information from anyone under 13.
        </P>
        <P>
          Be aware that TR1VIA runs in bars, restaurants, and venues that may
          admit minors. Because anyone can join a game by typing a room code, a
          child who picks up a phone and joins will have the same technical
          information collected automatically as any other player — an IP
          address and the device identifier described below — before they type
          anything. We do not ask for a player’s age.
        </P>
        <P>
          If you are a parent or guardian and believe a child under 13 has
          played and you want their information removed, email{" "}
          <a href="mailto:support@vyntechs.com" className="text-accent">
            support@vyntechs.com
          </a>{" "}
          with the date, venue, and the display name used, and we will locate
          and delete that record.
        </P>
      </Section>

      <Section title="What we collect automatically — from everyone">
        <H3>Server logs</H3>
        <P>
          Vercel, our hosting provider, receives and logs ordinary web-request
          data for every visit: your IP address (used to route the request and
          derive approximate city/region location), your browser and operating
          system (User-Agent), the page you came from (referrer), the pages you
          request, and timestamps. Vercel keeps these access logs for up to 30
          days. We do not separately store them.
        </P>
        <H3>The live game connection</H3>
        <P>
          Live games use a continuous connection provided by{" "}
          <B>Supabase Realtime</B>, a US-based service we use (see “Who we share
          data with”). Through that connection Supabase receives your IP address
          and connection timing. Some connection-liveness information — for
          example, when you were last seen and how long the game tab was in the
          background — is written to your player record and is kept along with
          that record after the game ends.
        </P>
        <H3>Answers, timing, and scores</H3>
        <P>
          To score fairly, TR1VIA records which answer you chose and how quickly
          you locked it in. <B>This information is stored in our database and is
          kept after the game ends</B> — it powers the end-of-game recap, the
          leaderboard, and the host’s ability to review past nights. It is
          linked to the device identifier described below.
        </P>
        <H3>Display names</H3>
        <P>
          If you enter a display name to join, it is shown to other players and
          to the host during the game, and it is <B>stored with your game data
          and the device identifier and kept after the game ends</B>. Please
          pick a nickname rather than your full real name.
        </P>
      </Section>

      <Section title="What we do NOT use">
        <P>
          To be clear about what TR1VIA does <i>not</i> do: we do not use Google
          Analytics, Vercel Analytics, or any other third-party analytics
          product; we do not use advertising cookies, tracking pixels, or
          retargeting; we do not sell or share your personal information for
          advertising; and we do not currently process Global Privacy Control
          (GPC) signals, because there is no advertising sale or share to opt out
          of. If that ever changes, we will update this policy and add real
          controls before turning anything on.
        </P>
      </Section>

      <Section title="What we collect — hosts only">
        <H3>Email address</H3>
        <P>
          When a host account is created, we store the host’s email address to
          identify the account and to create a login session when they sign in.
          We do not use host email addresses for marketing, and we do not send
          host emails through a third-party email-delivery provider.
        </P>
        <H3>Login session</H3>
        <P>
          When a host signs in, our authentication provider Supabase sets a
          session cookie in the browser to keep them logged in. It refreshes
          automatically and is cleared when the host signs out. It is used only
          for authentication, not for tracking or analytics.
        </P>
        <H3>Host dashboard activity</H3>
        <P>
          Actions a host takes in the dashboard — creating games, managing
          questions, ending sessions — are recorded so we can run the service
          and troubleshoot problems.
        </P>
      </Section>

      <Section title="Cookies and your device">
        <P>
          TR1VIA uses a small number of first-party cookies and one browser
          storage value. We do not use any advertising or third-party tracking
          cookies.
        </P>
        <Table
          head={["Name", "Set by", "Purpose", "Lasts"]}
          rows={[
            [
              "tr1via_device",
              "TR1VIA",
              "A signed cookie holding a random device identifier. It lets us recognize your device so we can keep your score during a game and recognize you if you rejoin. It is a persistent identifier and is stored with your player record.",
              "Up to 1 year (httpOnly)",
            ],
            [
              "tr1via_device_id",
              "TR1VIA",
              "A copy of the same device identifier kept in your browser’s local storage so the app can read it on your device.",
              "Until cleared",
            ],
            [
              "sb-…-auth-token",
              "Supabase",
              "Keeps a signed-in host logged in (hosts only).",
              "Per Supabase defaults; cleared on sign-out",
            ],
          ]}
        />
      </Section>

      <Section title="Who we share data with">
        <P>
          We do not sell your personal information, and we do not use it for
          advertising or retargeting. We share data only with the service
          providers that make TR1VIA work. Each acts as our processor, handling
          data on our behalf.
        </P>
        <Table
          head={["Provider", "Role", "What it receives", "Policy"]}
          rows={[
            [
              "Vercel (US)",
              "Hosting & server logs",
              "IP address, User-Agent, page requests, timestamps.",
              "vercel.com/legal/privacy-policy",
            ],
            [
              "Supabase (US)",
              "Database, authentication & live connection",
              "Host email; player display names; the device identifier; answers, timing, and scores; and player IP / connection timing through the live game connection.",
              "supabase.com/privacy",
            ],
            [
              "Pexels (US)",
              "Question images",
              "Image-search text from our server, and — because question images load directly from Pexels in your browser — your IP address and browser type when an image is shown.",
              "pexels.com/privacy-policy",
            ],
            [
              "Anthropic (US)",
              "AI question generation",
              "The trivia topic and instructions a host types, used to generate questions. No player or host personal information is sent.",
              "anthropic.com/legal/privacy",
            ],
          ]}
        />
        <P>
          We may also disclose information if required by law or valid legal
          process, or to protect the rights and safety of TR1VIA, our users, or
          the public.
        </P>
      </Section>

      <Section title="How long we keep data">
        <Table
          head={["Data", "How long we keep it"]}
          rows={[
            ["Server access logs (Vercel)", "Up to 30 days"],
            [
              "Player display names, answers, timing, and scores",
              "Stored in our database and kept after the game ends, so hosts can show recaps and leaderboards and review past nights. We keep this until you ask us to delete it, or until we no longer need it to run the service.",
            ],
            [
              "Device identifier (tr1via_device)",
              "Up to 1 year in the cookie; stored with your player record until that record is deleted",
            ],
            [
              "Host email address",
              "While the account is active; deleted within 30 days of a deletion request",
            ],
            [
              "Host dashboard activity",
              "Kept while needed to operate and troubleshoot the service",
            ],
          ]}
        />
        <P className="text-sm text-ink/60">
          We are honest that most game data is retained rather than deleted the
          moment a game ends; if you want yours removed, see “Your choices and
          rights.”
        </P>
      </Section>

      <Section title="International visitors">
        <P>
          TR1VIA is based in the United States and is offered to US venues. Our
          providers (Vercel, Supabase, Pexels, Anthropic) process data in the
          United States. If you access TR1VIA from the EU, EEA, UK, or another
          region with data-transfer rules, your information is transferred to and
          processed in the United States, and we rely on appropriate transfer
          safeguards (such as Standard Contractual Clauses) where they apply. We
          do not currently market TR1VIA to EU or UK customers; if we begin
          serving them, we will update this policy and appoint a local
          representative as required before doing so.
        </P>
      </Section>

      <Section title="Security">
        <UL>
          <li>All traffic to and from tr1via.com is encrypted with HTTPS (TLS).</li>
          <li>Access to host data and activity logs is limited to authorized people.</li>
          <li>Session and device cookies are signed and carry standard security attributes.</li>
        </UL>
        <P>
          No system is perfectly secure. If a breach affects hosts’ personal
          data, we will notify affected hosts without unreasonable delay and
          within the time required by applicable law (in Texas, no later than 60
          days after we confirm the breach). If you find a security problem, tell
          us at{" "}
          <a href="mailto:support@vyntechs.com" className="text-accent">
            support@vyntechs.com
          </a>
          .
        </P>
      </Section>

      <Section title="Your choices and rights">
        <P>
          We offer the following rights to everyone as a matter of policy,
          regardless of where you live. Depending on your state or country
          (for example, California, Virginia, Colorado, Connecticut, Texas, the
          EU, or the UK) some of these may also be legal rights.
        </P>
        <UL>
          <li><B>Know / access</B> — ask what information we hold about you.</li>
          <li><B>Delete</B> — ask us to delete your information.</li>
          <li><B>Correct</B> — ask us to fix inaccurate information.</li>
          <li><B>Portability</B> — ask for a copy of your information.</li>
          <li>
            <B>Object or restrict</B> — ask us to stop or limit certain
            processing.
          </li>
          <li>
            <B>Appeal</B> — if we deny a request, ask us to reconsider. Residents
            of states with an appeal right (including Virginia, Colorado,
            Connecticut, and Texas) may also escalate to their state attorney
            general.
          </li>
        </UL>
        <P>
          To exercise any of these, email{" "}
          <a href="mailto:support@vyntechs.com" className="text-accent">
            support@vyntechs.com
          </a>
          . We will respond within 45 days. Because players do not have accounts,
          we may not be able to find a specific player’s data without help — if
          you played a game, include the date, venue, approximate time, and the
          display name you used so we can locate it. We will not treat you
          differently for exercising a right.
        </P>
        <P>
          <B>Do we sell or share your data?</B> No. TR1VIA does not sell personal
          information and does not share it for cross-context behavioral
          advertising, as those terms are defined under California law. There is
          nothing to opt out of, so we do not provide a “Do Not Sell or Share”
          link.
        </P>
      </Section>

      <Section title="Changes to this policy">
        <P>
          If we make material changes, we will update the “Last updated” date,
          post the new version here, and — for hosts, who have email on file —
          email notice at least 30 days before the change takes effect. Players
          do not have accounts or email on file, so for players the posted
          policy is the notice. Continued use after a change takes effect, once
          you have had reasonable notice through this posted policy, means you
          accept the update. If you are a host and disagree, contact us.
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
      </footer>
    </main>
  );
}

/* ---- small presentational helpers (keep the policy body readable) ---- */

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

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px] leading-relaxed">
        <thead>
          <tr className="border-b border-ink/15 text-left">
            {head.map((h) => (
              <th key={h} className="py-2 pr-4 align-top font-semibold text-ink">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-ink/8 align-top text-ink/80">
              {row.map((cell, j) => (
                <td key={j} className="py-3 pr-4">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
