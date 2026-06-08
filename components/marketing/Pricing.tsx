// Pricing — the honest free-vs-AI block, shared by the hub and /pricing.
// Hosting is free forever; the only paid thing is optional AI question-writing
// at $4.99/mo. The featured (Host) card inverts to ink-on-paper for emphasis.
//
// Server component; reads theme vars from the wrapping ThemedSection.
import Link from "next/link";
import { Display, Eyebrow } from "@/components/system";

function Feature({ children, invert }: { children: React.ReactNode; invert?: boolean }) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className="h-[7px] w-[7px] shrink-0 rounded-full"
        style={{ background: "var(--accent)" }}
        aria-hidden
      />
      <span
        className="text-[16px]"
        style={{ color: invert ? "rgba(255,255,255,0.82)" : "var(--ink-mid)" }}
      >
        {children}
      </span>
    </li>
  );
}

export function Pricing() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-24 sm:py-28">
      <Eyebrow color="var(--accent)" size={13}>
        Pricing
      </Eyebrow>
      <Display size="clamp(30px, 4.6vw, 46px)" style={{ display: "block", marginTop: 14 }}>
        Free to host. Forever.
      </Display>

      <div className="mt-10 grid items-start gap-5 sm:grid-cols-2">
        {/* Host — featured */}
        <div className="rounded-3xl p-9" style={{ background: "var(--ink)", color: "var(--paper)" }}>
          <Eyebrow color="var(--pop)" size={12}>
            Host
          </Eyebrow>
          <div className="mt-3 flex items-end gap-1.5">
            <span className="text-[52px] font-bold leading-none">$0</span>
            <span className="pb-1 text-[16px] font-semibold" style={{ opacity: 0.6 }}>
              forever
            </span>
          </div>
          <ul className="mt-6 space-y-3">
            <Feature invert>Unlimited games &amp; players</Feature>
            <Feature invert>No per-night fee, ever</Feature>
            <Feature invert>Write your own questions</Feature>
            <Feature invert>Drives any venue TV</Feature>
          </ul>
          <Link
            href="/login"
            className="mt-8 inline-block rounded-2xl bg-accent px-7 py-4 text-[16px] font-bold text-white no-underline"
          >
            Start hosting — free →
          </Link>
        </div>

        {/* Trivia Nerd — optional add-on */}
        <div
          className="rounded-3xl p-9"
          style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
        >
          <Eyebrow color="var(--accent)" size={12}>
            Trivia Nerd · optional
          </Eyebrow>
          <div className="mt-3 flex items-end gap-1.5">
            <span className="text-[52px] font-bold leading-none text-[color:var(--ink)]">$4.99</span>
            <span className="pb-1 text-[16px] font-semibold" style={{ color: "var(--ink-mid)" }}>
              /month
            </span>
          </div>
          <ul className="mt-6 space-y-3">
            <Feature>Everything in Free</Feature>
            <Feature>AI writes a whole category</Feature>
            <Feature>Any topic, in seconds</Feature>
            <Feature>Cancel anytime</Feature>
          </ul>
          <Link
            href="/login"
            className="mt-8 inline-block rounded-2xl px-7 py-4 text-[16px] font-semibold no-underline text-[color:var(--ink)]"
            style={{ border: "1px solid var(--line)", background: "var(--surface)" }}
          >
            Add AI →
          </Link>
        </div>
      </div>
    </div>
  );
}
