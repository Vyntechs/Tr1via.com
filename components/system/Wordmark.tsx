// The TR1VIA brand mark.
// The app icon is the "Shuffled One" thumbnail: a 1 cut through shuffled
// answer tiles. The wordmark stays beside it for recognition, and the
// thumbnail wears the active seasonal skin. Never substitute a capital "I".
// Never set the "1" in sans.
//
// Marked client because it can read the active ThemeProvider when one exists.
// Marketing/server pages can still render it because the visual colors default
// to CSS variables and the seasonal skin falls back to the live calendar.

"use client";

import type { CSSProperties } from "react";
import type { ThemeKey } from "@/lib/theme/tokens";
import { useOptionalTheme } from "./ThemeProvider";
import { seasonalLogoSkinForTheme } from "./seasonalLogo";

export interface WordmarkProps {
  size?: number;
  /** Override the accent color (defaults to current theme accent). */
  accent?: string;
  /** Override the ink/letter color (defaults to current theme ink). */
  ink?: string;
  /** Override the secondary seasonal mark color. */
  pop?: string;
  tracking?: number;
  weight?: number;
  seasonal?: boolean;
  seasonalKey?: ThemeKey;
  style?: CSSProperties;
}

export function Wordmark({
  size = 32,
  accent,
  ink,
  pop,
  tracking = 0,
  weight = 700,
  seasonal = true,
  seasonalKey,
  style,
}: WordmarkProps) {
  const theme = useOptionalTheme();
  const a = accent ?? "var(--accent)";
  const i = ink ?? "var(--ink)";
  const p = pop ?? (accent ? a : "var(--pop)");
  const skin = seasonalKey ?? seasonalLogoSkinForTheme(theme?.themeKey ?? "daylight");

  return (
    <span
      data-logo-skin={seasonal ? skin : "none"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(7, size * 0.22),
        fontFamily: "var(--font-sans)",
        fontWeight: weight,
        fontSize: size,
        letterSpacing: `${tracking}em`,
        lineHeight: 1,
        color: i,
        ...style,
      }}
    >
      <ShuffledOneLogo
        skin={skin}
        size={size}
        accent={a}
        ink={i}
        pop={p}
        seasonal={seasonal}
      />
      <span style={{ display: "inline-flex", alignItems: "baseline" }}>
        <span>TR</span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: weight,
            fontSize: size * 1.04,
            marginInline: Math.max(1, size * 0.05),
            fontVariantNumeric: "tabular-nums",
            lineHeight: 0.94,
            color: a,
          }}
        >
          1
        </span>
        <span>VIA</span>
      </span>
    </span>
  );
}

function ShuffledOneLogo({
  skin,
  size,
  accent,
  ink,
  pop,
  seasonal,
}: {
  skin: ThemeKey;
  size: number;
  accent: string;
  ink: string;
  pop: string;
  seasonal: boolean;
}) {
  const markSize = size * 2.05;
  const tileStroke = "color-mix(in srgb, var(--ink) 28%, transparent)";

  return (
    <svg
      aria-hidden="true"
      data-logo-mark="shuffled-one"
      width={markSize}
      height={markSize}
      viewBox="0 0 72 72"
      fill="none"
      style={{
        flex: "0 0 auto",
        overflow: "visible",
        pointerEvents: "none",
        filter: "drop-shadow(0 8px 18px color-mix(in srgb, var(--ink) 18%, transparent))",
      }}
    >
      <rect
        x="5.5"
        y="5.5"
        width="61"
        height="61"
        rx="18"
        fill="#08070d"
        stroke={accent}
        strokeOpacity="0.28"
        strokeWidth="1.5"
      />
      <rect x="17" y="19" width="38" height="9" rx="3.5" fill="#1d2434" stroke={tileStroke} strokeWidth="1.4" />
      <rect x="17" y="32" width="38" height="9" rx="3.5" fill="#1d2434" stroke={tileStroke} strokeWidth="1.4" />
      <rect x="17" y="45" width="38" height="9" rx="3.5" fill="#1d2434" stroke={tileStroke} strokeWidth="1.4" />
      <rect x="17" y="32" width="19" height="9" rx="3.5" fill={accent} />
      <rect x="43" y="45" width="12" height="9" rx="3.5" fill={pop} />
      {seasonal && (
        <SeasonalLogoMotif skin={skin} accent={accent} ink={ink} pop={pop} />
      )}
      <path
        d="M25.5 31.8 43 21.6l6.9 12.6-17.7 10.1-6.7-12.5Z"
        fill="#fff8ec"
        stroke="#08070d"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <text
        x="40.8"
        y="58"
        fill="#fff8ec"
        stroke="#08070d"
        strokeWidth="1.4"
        paintOrder="stroke"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="49"
        fontWeight="900"
        letterSpacing="-0.08em"
      >
        1
      </text>
    </svg>
  );
}

function SeasonalLogoMotif({
  skin,
  accent,
  ink,
  pop,
}: {
  skin: ThemeKey;
  accent: string;
  ink: string;
  pop: string;
}) {
  const data = {
    "data-logo-motif": skin,
    "data-logo-motif-scale": "thumbnail",
  };

  switch (skin) {
    case "january":
      return (
        <g {...data}>
          <path d="M14 14v11M8.5 19.5h11M10.5 15.5l7 8M18 15.5l-7 8" stroke={pop} strokeWidth="2.1" strokeLinecap="round" />
          <path d="M54 47v10M49 52h10M50.8 48.8l6.4 6.4M57.2 48.8l-6.4 6.4" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
        </g>
      );
    case "february":
      return (
        <g {...data}>
          <path d="M53 14c4 0 6.7 3 6.7 6.5 0 5.8-7.7 9.6-10.2 12.6-2.6-3-10.2-6.8-10.2-12.6 0-3.5 2.7-6.5 6.7-6.5 1.8 0 3.2.9 4.5 2.4 1.2-1.5 2.6-2.4 4.5-2.4Z" fill={accent} fillOpacity="0.2" stroke={pop} strokeWidth="2" />
        </g>
      );
    case "march":
      return (
        <g {...data}>
          <circle cx="52" cy="17" r="4.8" fill={accent} fillOpacity="0.24" stroke={pop} strokeWidth="1.8" />
          <circle cx="60" cy="17" r="4.8" fill={accent} fillOpacity="0.24" stroke={pop} strokeWidth="1.8" />
          <circle cx="56" cy="25" r="4.8" fill={accent} fillOpacity="0.24" stroke={pop} strokeWidth="1.8" />
          <path d="M57 29c2.8 2.8 5.2 4.4 8.3 5.2" stroke={accent} strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "april":
      return (
        <g {...data}>
          <path d="M56 10c3.8 5 3.8 9 0 12.5-3.8-3.5-3.8-7.5 0-12.5ZM66 21c-4.8 3.8-8.8 3.8-12.2 0 3.4-3.8 7.4-3.8 12.2 0ZM56 32c-3.8-5-3.8-9 0-12.5 3.8 3.5 3.8 7.5 0 12.5Z" fill={accent} fillOpacity="0.2" stroke={pop} strokeWidth="1.9" strokeLinejoin="round" />
        </g>
      );
    case "may":
    case "june":
      return (
        <g {...data}>
          <path d="M49.5 7 39.5 33h8L41 65 58.5 30H49l.5-23Z" fill={pop} fillOpacity="0.7" stroke="#fff8ec" strokeOpacity="0.6" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M17 21c9-7 22-9 39-4M13 54c7 5 17 7 29 6" stroke={ink} strokeWidth="2.2" strokeLinecap="round" opacity="0.38" />
        </g>
      );
    case "july":
      return (
        <g {...data}>
          <path d="M12 17v9M7.5 21.5h9M8.7 18.2l6.6 6.6M15.3 18.2l-6.6 6.6" stroke={pop} strokeWidth="3" strokeLinecap="round" />
          <path d="M56 15v10M51 20h10M52.5 16.5l7 7M59.5 16.5l-7 7" stroke={accent} strokeWidth="2.8" strokeLinecap="round" />
          <path d="M58 51v6M55 54h6M55.8 51.8l4.4 4.4M60.2 51.8l-4.4 4.4" stroke={pop} strokeWidth="2.3" strokeLinecap="round" />
        </g>
      );
    case "august":
      return (
        <g {...data}>
          <circle cx="55" cy="20" r="8.5" fill={accent} fillOpacity="0.18" stroke={pop} strokeWidth="2" />
          <path d="M55 6v5M55 29v5M41 20h5M64 20h5M45 10l3.5 3.5M61.5 26.5 65 30M65 10l-3.5 3.5M48.5 26.5 45 30" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
        </g>
      );
    case "september":
      return (
        <g {...data}>
          <path d="M60 11C48 12 39 19 39 35c16-1 22-10 21-24Z" fill={accent} fillOpacity="0.22" stroke={pop} strokeWidth="2" strokeLinejoin="round" />
          <path d="M41 33c6-7 11-13 17-20" stroke={accent} strokeWidth="2" strokeLinecap="round" />
        </g>
      );
    case "october":
      return (
        <g {...data}>
          <path d="M54 10c-7 2-12 8-12 16s5 14 12 16c-3 2-6 3-10 3-10 0-18-8-18-19S34 7 44 7c4 0 7 1 10 3Z" fill={accent} fillOpacity="0.2" stroke={pop} strokeWidth="2" strokeLinejoin="round" />
          <path d="M58 21h7M61.5 17.5v7" stroke={accent} strokeWidth="2.2" strokeLinecap="round" />
        </g>
      );
    case "november":
      return (
        <g {...data}>
          <path d="M16 57c8-16 18-26 34-34" stroke={pop} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M17 56c3-11 10-15 21-14-3 11-10 15-21 14ZM32 42c-.5-10 5-16 17-19 .5 10-5 16-17 19Z" fill={accent} fillOpacity="0.22" stroke={accent} strokeWidth="2" strokeLinejoin="round" />
        </g>
      );
    case "december":
      return (
        <g {...data}>
          <path d="M55 9v36M45 22h20M42 33h26" stroke={accent} strokeWidth="2.4" strokeLinecap="round" />
          <path d="M55 9 46 22h18L42 54h26L55 9Z" fill={accent} fillOpacity="0.16" stroke={pop} strokeWidth="2.1" strokeLinejoin="round" />
          <circle cx="55" cy="9" r="2.6" fill={pop} />
        </g>
      );
    default:
      return null;
  }
}
