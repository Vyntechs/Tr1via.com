// The Moment — the anti-cheat centerpiece. One question on the "TV", four
// phones beside it, each showing the SAME four answers in a different order
// with the correct one (Paris) landing in a different slot every time. This is
// the most differentiated, most screenshot-worthy beat on the page — it proves
// "nobody can cheat" instead of asserting it.
//
// Server component, pure markup (the shuffle is three real hardcoded
// permutations, not an image). Reads theme vars from the wrapping ThemedSection,
// so it wears whatever month it's placed in.
import { Display, Eyebrow } from "@/components/system";

const SCREEN = "#0b0b12"; // device screens are their own dark surface, theme-independent

// Same four options, the correct one (index 0 = "Paris") shuffled to a new slot
// on each phone. The component highlights whichever pill === CORRECT.
const CORRECT = "Paris";
const PHONES: string[][] = [
  ["Paris", "Lyon", "Rome", "Nice"],
  ["Rome", "Paris", "Nice", "Lyon"],
  ["Lyon", "Nice", "Paris", "Rome"],
  ["Nice", "Rome", "Lyon", "Paris"],
];

function Phone({ options }: { options: string[] }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl p-3"
      style={{ background: SCREEN, border: "1px solid rgba(255,255,255,0.1)" }}
    >
      {options.map((o, i) => {
        const correct = o === CORRECT;
        return (
          <div
            key={i}
            className="rounded-lg px-3 py-2.5 text-[13px] font-semibold"
            style={
              correct
                ? { background: "var(--correct)", color: "#0b0b12" }
                : { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.85)" }
            }
          >
            {o}
          </div>
        );
      })}
    </div>
  );
}

export function TheMoment() {
  return (
    <div className="mx-auto max-w-[1000px] px-6 py-24 text-center sm:py-28">
      <Eyebrow color="var(--accent)" size={13}>
        The anti-cheat trick
      </Eyebrow>
      <Display
        size="clamp(34px, 5.2vw, 56px)"
        style={{ display: "block", marginTop: 16, lineHeight: 1.06 }}
      >
        Calling out the answer helps no one.
      </Display>
      <p
        className="mx-auto mt-5 max-w-[640px] text-[18px] leading-relaxed"
        style={{ color: "var(--ink-mid)" }}
      >
        Every phone shuffles the four answers into its own order. One question on
        the screen, four different layouts in four hands &mdash; so &ldquo;it&rsquo;s
        number three!&rdquo; means nothing.
      </p>

      {/* The TV */}
      <div
        className="mx-auto mt-14 flex max-w-[760px] items-center justify-between gap-6 rounded-2xl p-7 text-left"
        style={{ background: SCREEN, border: "1px solid rgba(255,255,255,0.1)" }}
      >
        <div>
          <Eyebrow color="var(--pop)" size={11}>
            Question 4 · Geography
          </Eyebrow>
          <Display size="clamp(22px, 3vw, 32px)" color="#fff" style={{ display: "block", marginTop: 8 }}>
            Which city is the capital of France?
          </Display>
        </div>
        <div
          className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full text-[22px] font-bold text-white"
          style={{ border: "5px solid var(--accent)" }}
        >
          20
        </div>
      </div>

      {/* The phones */}
      <div className="mx-auto mt-7 grid max-w-[760px] grid-cols-2 gap-4 sm:grid-cols-4">
        {PHONES.map((options, i) => (
          <Phone key={i} options={options} />
        ))}
      </div>
      <p className="mt-7 text-[15px] font-semibold" style={{ color: "var(--ink-mid)" }}>
        Same right answer &mdash; a different spot on every phone.
      </p>
    </div>
  );
}
