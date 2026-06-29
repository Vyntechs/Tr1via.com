// Proof — honest social proof. This section NEVER fabricates a testimonial.
// With no quote it shows only signal that is true today (live weekly nights,
// the cheat-proof guarantee, free to host). When a real quote is supplied, use
// only approved public attribution: first name + role, no venue/city/photo.
//
// Server component; reads theme vars from the wrapping ThemedSection.
import { Display, Eyebrow } from "@/components/system";

export interface ProofQuote {
  /** The host's real words. */
  text: string;
  /** Approved public attribution, e.g. "Heather, weekly trivia host". */
  attribution: string;
}

const SIGNALS = [
  "Live trivia nights running weekly",
  "Unlimited players · $0 to host",
  "Per-phone answers · cheat-proof",
];

export function Proof({ quote }: { quote: ProofQuote | null }) {
  return (
    <div className="mx-auto max-w-[900px] px-6 py-24 text-center sm:py-28">
      <Eyebrow color="var(--accent)" size={13}>
        Real nights, running now
      </Eyebrow>

      {quote && (
        <figure data-testid="proof-quote" className="mt-6">
          <Display
            size="clamp(24px, 3.4vw, 36px)"
            style={{ display: "block", lineHeight: 1.28 }}
          >
            &ldquo;{quote.text}&rdquo;
          </Display>
          <figcaption className="mt-4 text-[16px] font-semibold" style={{ color: "var(--ink-mid)" }}>
            &mdash; {quote.attribution}
          </figcaption>
        </figure>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {SIGNALS.map((s) => (
          <span
            key={s}
            className="rounded-full px-5 py-3 text-[15px] font-semibold text-[color:var(--ink)]"
            style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
