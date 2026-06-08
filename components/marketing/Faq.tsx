// FAQ — objection-killing questions for /pricing. Exports FAQ_ITEMS so the page
// can emit FAQPage structured data from the SAME source as the visible copy
// (claims mirror copy exactly — no schema/markup drift).
//
// Native <details>/<summary> accordion: accessible and interactive with ZERO
// client JS. Server component; reads theme vars from the wrapping ThemedSection.
import { Display, Eyebrow } from "@/components/system";

export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: "Is it really free to host?",
    a: "Yes — unlimited games, unlimited players, no per-night fee. The only paid thing is optional AI question-writing at $4.99/month, cancel anytime.",
  },
  {
    q: "Do players need to download an app?",
    a: "No. They scan a code on the screen and play in their phone's browser. No install, no sign-up.",
  },
  {
    q: "What gear do I need?",
    a: "A laptop to drive the venue TV and the phones already in everyone's pockets. No buzzers, no hardware.",
  },
  {
    q: "Can I write my own questions?",
    a: "Always. Type your own, or let TR1VIA write a whole category for you.",
  },
  {
    q: "Can people cheat?",
    a: "No — every phone shuffles the four answers into its own order, so calling out “number three” means nothing.",
  },
];

export function Faq() {
  return (
    <div className="mx-auto max-w-[760px] px-6 py-24 sm:py-28">
      <Eyebrow color="var(--accent)" size={13}>
        Questions
      </Eyebrow>
      <Display size="clamp(28px, 4vw, 40px)" style={{ display: "block", marginTop: 14 }}>
        The quick answers.
      </Display>

      <div className="mt-9 divide-y" style={{ borderColor: "var(--line)" }}>
        {FAQ_ITEMS.map(({ q, a }) => (
          <details key={q} className="group py-5" style={{ borderColor: "var(--line)" }}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[18px] font-semibold text-[color:var(--ink)]">
              {q}
              <span
                className="shrink-0 text-[22px] leading-none transition-transform group-open:rotate-45"
                style={{ color: "var(--accent)" }}
                aria-hidden
              >
                +
              </span>
            </summary>
            <p className="mt-3 max-w-[640px] text-[16px] leading-relaxed" style={{ color: "var(--ink-mid)" }}>
              {a}
            </p>
          </details>
        ))}
      </div>
    </div>
  );
}
