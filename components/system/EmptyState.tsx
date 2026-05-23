// EmptyState — the "nothing here yet" panel.
//
// Used inside loading.tsx (rare — Spinner is usually the lead) and very
// commonly inside not-found.tsx. Also drops into any inline list whose data
// set is empty (suggestions, past nights, etc.).
//
// Visual character: centred column, the title set in the Display voice,
// optional description in the ink-mid body voice, optional action below.
// An optional icon sits above the title — by default we surface a tasteful
// motif glyph (Leaf), but callers can pass any ReactNode.
//
// Themed via CSS vars so the panel works inside any shell (PhoneScreen,
// TVStage, LaptopShell) without re-wiring.

"use client";

import type { CSSProperties, ReactNode } from "react";
import { Eyebrow } from "./Eyebrow";
import { Leaf } from "./motifs/Leaf";

export interface EmptyStateProps {
  /** The hero line. Set in the Display voice. */
  title: string;
  /** Optional supporting copy. Set in the ink-mid body voice. */
  description?: ReactNode;
  /** Optional icon above the title. Defaults to a small Leaf motif. Pass
   *  `null` to omit. */
  icon?: ReactNode | null;
  /** Optional action below the description (e.g. a button or link). */
  action?: ReactNode;
  /** Eyebrow text above the icon. Defaults to "NOTHING HERE YET". */
  eyebrow?: string;
  /** Optional override for the title color. Defaults to var(--ink). */
  titleColor?: string;
  /** Tighter typography for use in narrow surfaces (player phone). */
  compact?: boolean;
  style?: CSSProperties;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  eyebrow = "NOTHING HERE YET",
  titleColor,
  compact = false,
  style,
}: EmptyStateProps) {
  const iconNode =
    icon === undefined ? <Leaf size={compact ? 22 : 28} color="var(--accent)" /> : icon;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: compact ? 14 : 18,
        textAlign: "left",
        color: "var(--ink)",
        ...style,
      }}
    >
      {iconNode !== null && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {iconNode}
          {eyebrow && (
            <Eyebrow color="var(--ink-mid)" size={compact ? 9 : 10}>
              {eyebrow}
            </Eyebrow>
          )}
        </div>
      )}
      <h2
        style={{
          margin: 0,
          // Mirror the Display voice in-place so the title is also a
          // landmark heading the screen-reader can jump to.
          fontFamily: "var(--font-display)",
          fontOpticalSizing: "auto",
          fontWeight: 600,
          fontStretch: "85%",
          fontSize: compact ? 36 : 48,
          letterSpacing: "-0.035em",
          lineHeight: 0.92,
          color: titleColor ?? "var(--ink)",
        }}
      >
        {title}
      </h2>
      {description !== undefined && description !== null && (
        <p
          style={{
            margin: 0,
            color: "var(--ink-mid)",
            fontSize: compact ? 13.5 : 14.5,
            lineHeight: 1.5,
            maxWidth: compact ? 280 : 360,
          }}
        >
          {description}
        </p>
      )}
      {action && <div style={{ marginTop: compact ? 4 : 8 }}>{action}</div>}
    </div>
  );
}
