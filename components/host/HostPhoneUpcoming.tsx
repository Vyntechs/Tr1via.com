"use client";

import Image from "next/image";
import { PhoneScreen } from "@/components/shells";
import { Eyebrow, Numeric, ThemeProvider, useTheme } from "@/components/system";
import { readableForeground } from "@/lib/theme/contrast";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostPhoneUpcomingProps {
  themeKey?: ThemeKey;
  hostName?: string;
  categoryName?: string;
  pointValue?: number;
  prompt?: string;
  options?: [string, string, string, string];
  correctIndex?: 0 | 1 | 2 | 3;
  factBlurb?: string | null;
  imageUrl?: string | null;
  imageAttribution?: string | null;
  onReveal?: () => void;
  onBack?: () => void;
  isRevealing?: boolean;
}

export function HostPhoneUpcoming({ themeKey, ...props }: HostPhoneUpcomingProps) {
  if (themeKey) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <HostPhoneUpcomingInner {...props} />
      </ThemeProvider>
    );
  }
  return <HostPhoneUpcomingInner {...props} />;
}

function HostPhoneUpcomingInner({
  hostName = "Heather",
  categoryName = "Geography",
  pointValue = 100,
  prompt = "Which U.S. state has the longest coastline?",
  options = ["Florida", "Alaska", "California", "Maine"],
  correctIndex = 1,
  factBlurb,
  imageUrl,
  imageAttribution,
  onReveal,
  onBack,
  isRevealing = false,
}: HostPhoneUpcomingProps) {
  const { t } = useTheme();
  const firstName = hostName.trim().split(/\s+/)[0] || "Heather";

  return (
    <PhoneScreen weatherIntensity={0.35}>
      <div
        style={{
          padding: "10px 12px",
          border: `1px solid ${t.pop}`,
          borderRadius: 12,
          background: t.surfaceH,
          color: t.ink,
        }}
      >
        <Eyebrow color={t.pop} size={9}>
          Host private
        </Eyebrow>
        <div style={{ marginTop: 4, fontSize: 12, fontWeight: 800, lineHeight: 1.35 }}>
          Private on {firstName}’s phone · Not on TV
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "baseline",
          padding: "16px 0 13px",
          borderBottom: `1px solid ${t.line}`,
        }}
      >
        <Eyebrow color={t.accent} size={10}>{categoryName}</Eyebrow>
        <Numeric size={13} color={t.inkMid}>{pointValue} points</Numeric>
      </div>

      {imageUrl ? (
        <figure style={{ margin: "14px 0 0" }}>
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "16 / 9",
              overflow: "hidden",
              borderRadius: 12,
              border: `1px solid ${t.line}`,
              background: t.surface,
            }}
          >
            <Image
              src={imageUrl}
              alt="Question image preview"
              fill
              unoptimized
              sizes="(max-width: 440px) 100vw, 440px"
              style={{ objectFit: "cover" }}
            />
          </div>
          <figcaption style={{ marginTop: 5, color: t.inkMute, fontSize: 10 }}>
            <span style={{ color: t.correct, fontWeight: 800 }}>Image ready</span>
            {imageAttribution ? ` · ${imageAttribution}` : ""}
          </figcaption>
        </figure>
      ) : (
        <p style={{ margin: "12px 0 0", color: t.inkMute, fontSize: 11 }}>
          No question image attached
        </p>
      )}

      <section aria-labelledby="private-question-heading" style={{ padding: "17px 0" }}>
        <Eyebrow color={t.inkMute} size={9}>Question</Eyebrow>
        <h2
          id="private-question-heading"
          style={{
            margin: "7px 0 0",
            color: t.ink,
            fontSize: 21,
            fontWeight: 650,
            letterSpacing: "-0.015em",
            lineHeight: 1.25,
          }}
        >
          {prompt}
        </h2>
      </section>

      <div style={{ display: "grid", gap: 8 }}>
        {options.map((text, index) => {
          const correct = index === correctIndex;
          return (
            <div
              key={`${index}-${text}`}
              style={{
                minHeight: 48,
                padding: "10px 12px",
                border: `1px solid ${correct ? t.correct : t.line}`,
                borderRadius: 10,
                background: correct ? t.surfaceH : t.surface,
                display: "flex",
                alignItems: "center",
                gap: 10,
                boxSizing: "border-box",
              }}
            >
              <Numeric color={correct ? t.correct : t.inkMid} size={13}>{index + 1}</Numeric>
              <span style={{ flex: 1, color: t.ink, fontSize: 14, lineHeight: 1.3 }}>{text}</span>
              {correct && (
                // CORRECT stays visible only on this private host component.
                <Eyebrow color={t.correct} size={9}>Correct</Eyebrow>
              )}
            </div>
          );
        })}
      </div>

      <section
        aria-label="Host note"
        style={{
          marginTop: 14,
          padding: 12,
          borderRadius: 10,
          background: t.surface,
          color: t.inkMid,
          fontSize: 12,
          lineHeight: 1.45,
        }}
      >
        <Eyebrow color={t.accent} size={9}>Fact / tip</Eyebrow>
        <p style={{ margin: "6px 0 0" }}>{factBlurb || "No host note for this question."}</p>
      </section>

      <div style={{ marginTop: "auto", paddingTop: 16, display: "grid", gap: 10 }}>
        <button
          type="button"
          onClick={onReveal}
          disabled={isRevealing || !onReveal}
          style={{
            minHeight: 54,
            border: 0,
            borderRadius: 13,
            background: t.accent,
            color: readableForeground(t.accent),
            fontFamily: "var(--font-sans)",
            fontSize: 17,
            fontWeight: 800,
            cursor: isRevealing ? "wait" : "pointer",
            opacity: isRevealing ? 0.72 : 1,
          }}
        >
          {isRevealing ? "Showing…" : "Show question"}
        </button>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={isRevealing}
            style={{
              minHeight: 48,
              border: `1px solid ${t.line}`,
              borderRadius: 13,
              background: "transparent",
              color: t.ink,
              fontFamily: "var(--font-sans)",
              fontSize: 14,
              fontWeight: 750,
              cursor: isRevealing ? "wait" : "pointer",
            }}
          >
            Back to board
          </button>
        )}
      </div>
    </PhoneScreen>
  );
}
