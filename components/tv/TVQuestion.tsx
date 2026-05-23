// TV — question reveal. Bold category banner across the top, big editorial
// question text, four chunky cards underneath showing the scrambled order.
// The TV always shows numbers — each phone gets its own private order
// (scramble enforced server-side).

"use client";

import { TVStage, TVHeader } from "@/components/shells";
import {
  Display,
  Eyebrow,
  Numeric,
  PointTag,
  ThemeProvider,
  TVTimerArc,
  useTheme,
} from "@/components/system";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVQuestionOption {
  n: number;
  text: string;
}

export interface TVQuestionProps {
  themeKey?: ThemeKey;
  seconds?: number;
  category?: string;
  value?: number;
  question?: string;
  options?: TVQuestionOption[];
}

export function TVQuestion(props: TVQuestionProps) {
  if (props.themeKey) {
    return (
      <ThemeProvider themeKey={props.themeKey}>
        <TVQuestionInner {...props} />
      </ThemeProvider>
    );
  }
  return <TVQuestionInner {...props} />;
}

function TVQuestionInner({
  seconds = 14,
  category = "Geography",
  value = 100,
  question = "Which U.S. state has the longest coastline?",
  options,
}: TVQuestionProps) {
  const { t } = useTheme();
  const cc = categoryColor(category, t.accent);
  const opts: TVQuestionOption[] = options ?? [
    { n: 1, text: "Florida" },
    { n: 2, text: "Alaska" },
    { n: 3, text: "California" },
    { n: 4, text: "Maine" },
  ];

  return (
    <TVStage>
      <TVHeader
        accent={cc}
        left="GAME 1 · LIVE"
        right="EVERY PHONE: SCRAMBLED · YOUR # IS YOURS"
      />

      {/* Category banner */}
      <div
        style={{
          margin: "24px 56px 0",
          padding: "16px 24px",
          borderRadius: 14,
          background: cc,
          color: "#0E0805",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Eyebrow color="rgba(14,8,5,.65)" size={11}>CATEGORY</Eyebrow>
          <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.015em" }}>
            {category}
          </span>
        </div>
        <PointTag value={value} color="#0E0805" ink={cc} size="md" />
      </div>

      <div
        style={{
          flex: 1,
          padding: "28px 56px 0",
          display: "grid",
          gridTemplateColumns: "1fr 180px",
          gap: 56,
          alignItems: "flex-start",
          position: "relative",
          zIndex: 1,
        }}
      >
        <Display size={86} color={t.ink} weight={500} tracking={-0.025}>
          {question}
        </Display>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <TVTimerArc accent={cc} seconds={seconds} />
          <Eyebrow color={seconds <= 5 ? t.wrong : cc} size={10}>
            {seconds <= 5 ? "FINAL SECONDS" : "SPEED BONUS < 5s"}
          </Eyebrow>
        </div>
      </div>

      <div
        style={{
          padding: "36px 56px 0",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 18,
          position: "relative",
          zIndex: 1,
        }}
      >
        {opts.map((o) => (
          <div
            key={o.n}
            style={{
              background: t.dark ? "rgba(244,230,196,.06)" : "#FFF",
              border: `1.5px solid ${t.line}`,
              borderRadius: 16,
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "20px 24px",
              minHeight: 110,
            }}
          >
            <Numeric size={84} weight={700} color={cc} tracking={-0.05} style={{ lineHeight: 1 }}>
              {o.n}
            </Numeric>
            <span style={{ fontSize: 22, color: t.inkMid, fontWeight: 500, letterSpacing: "-0.005em" }}>
              {o.text}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          padding: "16px 56px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: "auto",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: cc,
              animation: "tr1via-pulse 1s ease-in-out infinite",
            }}
          />
          <Eyebrow color={t.inkMid} size={11}>21 OF 32 LOCKED IN</Eyebrow>
          <div style={{ width: 200, height: 4, background: t.line, borderRadius: 99, overflow: "hidden" }}>
            <div style={{ width: "66%", height: "100%", background: cc }} />
          </div>
        </div>
        <Eyebrow color={t.inkMute} size={10}>READ HERE · TAP ON YOUR PHONE</Eyebrow>
      </div>
    </TVStage>
  );
}
