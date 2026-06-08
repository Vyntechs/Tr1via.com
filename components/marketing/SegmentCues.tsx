// Segment cues — the "any and all" strip. A universal page needs each kind of
// buyer to self-identify in one glance: the venue owner, the working
// quizmaster, the casual group host. Three light cards, not three funnels.
//
// Server component; reads theme vars from the wrapping ThemedSection.
import { Display, Eyebrow } from "@/components/system";

const CUES: { dot: string; title: string; body: string }[] = [
  {
    dot: "var(--accent)",
    title: "For your venue",
    body: "Fill the slow nights. Regulars come back for the next one — and buy another round while they're at it.",
  },
  {
    dot: "var(--pop)",
    title: "For your night",
    body: "Look pro with zero prep. TR1VIA writes the questions and runs the clock, so you just work the mic.",
  },
  {
    dot: "var(--correct)",
    title: "For your group",
    body: "Office, club, or the kitchen table. Free, fair, and no app for anyone to download.",
  },
];

export function SegmentCues() {
  return (
    <div className="mx-auto max-w-[1100px] px-6 py-24 sm:py-28">
      <Eyebrow color="var(--accent)" size={13}>
        Whatever your room is
      </Eyebrow>
      <Display size="clamp(28px, 4vw, 40px)" style={{ display: "block", marginTop: 14 }}>
        One game. Every kind of room.
      </Display>

      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {CUES.map((c) => (
          <div
            key={c.title}
            className="rounded-2xl p-7"
            style={{ background: "var(--surface)", border: "1px solid var(--line)" }}
          >
            <span
              className="block h-9 w-9 rounded-full"
              style={{ background: c.dot }}
              aria-hidden
            />
            <h3 className="mt-4 text-[20px] font-bold leading-snug text-[color:var(--ink)]">
              {c.title}
            </h3>
            <p className="mt-2 text-[16px] leading-relaxed" style={{ color: "var(--ink-mid)" }}>
              {c.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
