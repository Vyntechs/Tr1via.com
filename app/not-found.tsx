// Top-level 404 — anything that doesn't match a registered route lands here.
// Player typo-ing a room URL? They land on /(player)/join via /join lookup.
// This is a backstop for any other miss.

import Link from "next/link";
import { Wordmark } from "@/components/system/Wordmark";
import { EmptyState } from "@/components/system/EmptyState";

export default function NotFoundPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        fontFamily: "var(--font-sans)",
        color: "var(--ink)",
        background: "var(--paper)",
        gap: 32,
      }}
    >
      <Wordmark size={32} />
      <EmptyState
        eyebrow="404 · WRONG TURN"
        title="That page isn't here."
        description="The link you followed might be stale, or the page may have moved. Head back to start."
        action={
          <Link
            href="/"
            style={{
              display: "inline-block",
              background: "var(--accent)",
              color: "#FFF",
              padding: "14px 24px",
              borderRadius: 12,
              fontWeight: 700,
              fontSize: 15,
              textDecoration: "none",
              boxShadow: "0 12px 28px -10px var(--accent)",
            }}
          >
            Take me home  →
          </Link>
        }
        style={{ alignItems: "center", textAlign: "center" }}
      />
    </main>
  );
}
