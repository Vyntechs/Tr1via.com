// TV · LOCK-IN base. Shared scaffold for all lock-in choreography variants.
// Pinned question (Geography · 100 · "Which U.S. state has the longest
// coastline?") + the four answer cards + a 10-second timer arc. The variant
// itself supplies the lock-in visualization via `children`, occupying the
// lower-third of the stage.

"use client";

import type { ReactNode } from "react";
import {
  Display,
  Eyebrow,
  Numeric,
  PointTag,
  TVTimerArc,
  ThemeProvider,
  useTheme,
} from "@/components/system";
import { TVStage, TVHeader } from "@/components/shells";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface LockInBaseProps {
  themeKey?: ThemeKey;
  children: ReactNode;
  variantLabel: string;
  recommended?: boolean;
}

export function LockInBase({ themeKey, children, variantLabel, recommended }: LockInBaseProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <LockInBaseInner variantLabel={variantLabel} recommended={recommended}>
          {children}
        </LockInBaseInner>
      </ThemeProvider>
    );
  }
  return (
    <LockInBaseInner variantLabel={variantLabel} recommended={recommended}>
      {children}
    </LockInBaseInner>
  );
}

function LockInBaseInner({
  children,
  variantLabel,
  recommended,
}: {
  children: ReactNode;
  variantLabel: string;
  recommended?: boolean;
}) {
  const { t } = useTheme();
  const cc = categoryColor("Geography", t.accent);
  return (
    <TVStage>
      <TVHeader accent={cc} left="GAME 1 · LIVE" right="EVERY PHONE: SCRAMBLED · YOUR # IS YOURS" />

      {/* Category banner */}
      <div style={{ margin: "20px 56px 0", padding: "14px 22px", borderRadius: 14, background: cc, color: "#0E0805", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Eyebrow color="rgba(14,8,5,.65)" size={11}>CATEGORY</Eyebrow>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.015em" }}>Geography</span>
        </div>
        <PointTag value={100} color="#0E0805" ink={cc} size="md" />
      </div>

      <div style={{ padding: "20px 56px 0", display: "grid", gridTemplateColumns: "1fr 140px", gap: 36, alignItems: "flex-start" }}>
        <Display size={56} color={t.ink} weight={500} tracking={-0.025}>
          Which U.S. state has the longest coastline?
        </Display>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <TVTimerArc accent={cc} seconds={10} size={120} />
          <Eyebrow color={cc} size={10}>FINAL 10s</Eyebrow>
        </div>
      </div>

      <div style={{ padding: "20px 56px 0", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {[
          { n: 1, text: "Florida" },
          { n: 2, text: "Alaska" },
          { n: 3, text: "California" },
          { n: 4, text: "Maine" },
        ].map((o) => (
          <div key={o.n} style={{
            background: t.dark ? "rgba(244,230,196,.05)" : "#FFF",
            border: `1.5px solid ${t.line}`,
            borderRadius: 14, padding: "14px 18px",
            display: "flex", alignItems: "center", gap: 14, minHeight: 80,
          }}>
            <Numeric size={52} weight={700} color={cc} tracking={-0.05} style={{ lineHeight: 1 }}>{o.n}</Numeric>
            <span style={{ fontSize: 18, color: t.inkMid, fontWeight: 500, letterSpacing: "-0.005em" }}>{o.text}</span>
          </div>
        ))}
      </div>

      <div style={{ padding: "20px 56px 16px", flex: 1, display: "flex", flexDirection: "column" }}>
        {children}
      </div>

      <div style={{ padding: "0 56px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow color={t.inkMid} size={10}>{variantLabel}</Eyebrow>
        {recommended && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: t.correct }} />
            <Eyebrow color={t.correct} size={10}>RECOMMENDED FOR THE VENUE</Eyebrow>
          </div>
        )}
      </div>
    </TVStage>
  );
}
