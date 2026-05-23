// Dev gallery index. Links to every named design canvas.
// Visit at /dev. Reached from the placeholder home page on root.

import Link from "next/link";

const GALLERIES = [
  { href: "/dev/system",    title: "Design system",     hint: "Every atom in every theme — palettes, typography, weather." },
  { href: "/dev/player",    title: "Player screens",     hint: "9 player phone screens, swappable by theme." },
  { href: "/dev/tv",        title: "Venue TV",           hint: "8 TV screens (lobby → grid → question → reveal → finale)." },
  { href: "/dev/tv/lockin", title: "Lock-in pile-up",    hint: "The tile pile-up animation when players answer." },
  { href: "/dev/host",      title: "Host laptop",        hint: "Dashboard, setup, live console." },
  { href: "/dev/host/gen",  title: "Question generation", hint: "8-step Claude generation flow + manual entry + failure UI." },
];

export default function DevIndex() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "64px 24px",
        maxWidth: 720,
        margin: "0 auto",
        fontFamily: "var(--font-sans)",
        color: "var(--ink)",
        background: "var(--paper)",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 48,
          letterSpacing: "-0.04em",
          margin: 0,
        }}
      >
        Dev canvases
      </h1>
      <p style={{ color: "var(--ink-mid)", lineHeight: 1.5, marginTop: 8, marginBottom: 32 }}>
        Internal browsable galleries — every screen in every state. Use these for visual review and theme spot-checks.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {GALLERIES.map((g) => (
          <li key={g.href}>
            <Link
              href={g.href}
              style={{
                display: "block",
                padding: "16px 20px",
                borderRadius: 12,
                background: "var(--surface)",
                border: "1px solid var(--line)",
                color: "var(--ink)",
                textDecoration: "none",
                transition: "border-color .2s, transform .2s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 14,
                }}
              >
                <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: "-0.01em" }}>{g.title}</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--ink-mute)",
                    letterSpacing: "0.06em",
                  }}
                >
                  {g.href}
                </span>
              </div>
              <p style={{ marginTop: 6, marginBottom: 0, color: "var(--ink-mid)", fontSize: 13.5, lineHeight: 1.45 }}>
                {g.hint}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
