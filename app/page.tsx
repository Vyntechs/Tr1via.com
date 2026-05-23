import Link from "next/link";

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        fontFamily: "var(--font-sans)",
        color: "var(--ink)",
        background: "var(--paper)",
        gap: 24,
      }}
    >
      <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 64, letterSpacing: "-0.04em", margin: 0 }}>
        TR<span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>1</span>VIA
      </h1>
      <p style={{ color: "var(--ink-mid)", maxWidth: 520, textAlign: "center", lineHeight: 1.5 }}>
        Live trivia, designed to make the room feel alive. The app is being built — visit{" "}
        <Link href="/_dev/system" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
          /_dev/system
        </Link>{" "}
        to browse the design system, or{" "}
        <Link href="/_dev/all" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
          /_dev/all
        </Link>{" "}
        for every screen.
      </p>
    </main>
  );
}
