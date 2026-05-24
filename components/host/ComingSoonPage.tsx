// Shared "coming soon" scaffold used by the placeholder routes under
// /host/* that the sidebar links to but that don't have real UIs yet.
// Keeps the visual continuity with the rest of the host laptop surface
// (LaptopShell + tokens) instead of a blank Next.js 404 / wrong-feel screen.

"use client";

import Link from "next/link";
import { LaptopShell } from "@/components/shells";
import { Eyebrow, useTheme } from "@/components/system";

export interface ComingSoonPageProps {
  eyebrow: string;
  title: string;
  body: string;
}

export function ComingSoonPage({ eyebrow, title, body }: ComingSoonPageProps) {
  return (
    <LaptopShell title={`tr1via.com / ${eyebrow.toLowerCase()}`}>
      <ComingSoonInner eyebrow={eyebrow} title={title} body={body} />
    </LaptopShell>
  );
}

function ComingSoonInner({ eyebrow, title, body }: ComingSoonPageProps) {
  const { t } = useTheme();
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 80px",
        textAlign: "center",
        gap: 18,
      }}
    >
      <Eyebrow color={t.accent} size={12}>
        {eyebrow}
      </Eyebrow>
      <div
        style={{
          fontSize: 44,
          fontWeight: 700,
          color: t.ink,
          letterSpacing: "-0.02em",
          maxWidth: 640,
          lineHeight: 1.15,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 16,
          color: t.inkMid,
          maxWidth: 540,
          lineHeight: 1.5,
        }}
      >
        {body}
      </div>
      <Link
        href="/host"
        style={{
          marginTop: 18,
          padding: "12px 22px",
          borderRadius: 10,
          background: t.accent,
          color: "#FFF",
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
          fontFamily: "var(--font-sans)",
        }}
      >
        Back to tonight
      </Link>
    </div>
  );
}
