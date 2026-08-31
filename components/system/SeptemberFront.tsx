// September — "First Cool Front". The night Texas finally exhales.
//
// September is still visibly summer here. The seasonal change is felt before
// it is seen: clay-warm air retreats low and right while a clean blue-green
// current opens the room from the upper left. One broad feathered boundary and
// one clipped pressure contour make that handoff physical without turning the
// game into a weather map. A distant, floodlit stadium horizon and faint chalk
// hashes add the second read: this front arrived on a Texas football night.
//
// The TV question is deliberately still, compact surfaces keep only a cropped
// static horizon, and self-painted reveals get nothing. No motion is a status
// signal. Reduced motion keeps the static identity and drops the veil.

"use client";

import type { CSSProperties } from "react";
import type { AugustPageName } from "./AugustPage";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

export interface SeptemberFrontProps {
  /** 0 = off, 1 = default, >1 = a clearer finale atmosphere. */
  intensity?: number;
  /** Phone/card-sized surface: stronger static corner fields, with no motion. */
  compact?: boolean;
  /** False when a reveal or other special moment owns its background. */
  substrate?: boolean;
  /** TV state: questions stay motionless and visually quiet. */
  page?: AugustPageName;
}

const layer = (style: CSSProperties): CSSProperties => ({
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  ...style,
});

function Contours({ quiet }: { quiet: boolean }) {
  return (
    <svg
      data-testid="september-front-contours"
      viewBox="0 0 1280 720"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={layer({ opacity: quiet ? 0.2 : 0.48 })}
    >
      <path
        d="M-190 205 C 90 54, 310 92, 545 -56"
        fill="none"
        stroke="#72B8B0"
        strokeLinecap="round"
        strokeWidth="2.2"
        opacity=".34"
      />
    </svg>
  );
}

function CompactPressureEdge() {
  return (
    <svg
      data-testid="september-front-compact-edge"
      viewBox="0 0 380 760"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={layer({ opacity: 0.42 })}
    >
      <path
        d="M-70 122 C 78 48, 218 88, 438 -42"
        fill="none"
        stroke="#72B8B0"
        strokeLinecap="round"
        strokeWidth="1.6"
        opacity=".48"
      />
    </svg>
  );
}

function DistantStadium({ compact, finale }: { compact: boolean; finale: boolean }) {
  const viewWidth = compact ? 380 : 1280;
  const viewHeight = compact ? 760 : 720;
  const silhouette = compact
    ? "M-20 760V718H50V713H120V708H170V704H210V708H260V713H330V718H400V760Z"
    : "M-40 720V670H120V663H260V655H420V647H560V637H590V630H690V637H720V647H860V655H1020V663H1160V670H1320V720Z";

  return (
    <div
      data-testid="september-distant-stadium"
      style={layer({ overflow: "hidden" })}
    >
      <div
        data-testid="september-stadium-horizon-glow"
        style={{
          position: "absolute",
          left: compact ? "-8%" : "2%",
          right: compact ? "-8%" : "2%",
          bottom: compact ? "-2%" : "0%",
          height: compact ? "20%" : "36%",
          background:
            "radial-gradient(ellipse at 16% 100%, rgba(243,228,195,.42), transparent 58%)," +
            "radial-gradient(ellipse at 84% 100%, rgba(214,90,50,.34), transparent 58%)",
          filter: compact ? "blur(14px)" : "blur(22px)",
          mixBlendMode: "screen",
          opacity: finale ? 0.7 : compact ? 0.5 : 0.58,
        }}
      />
      <div
        data-testid="september-stadium-light-haze"
        style={{
          position: "absolute",
          left: compact ? "4%" : "1%",
          right: compact ? "4%" : "1%",
          bottom: compact ? "8.4%" : "12.4%",
          height: 1,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(243,228,195,.24) 14%, transparent 32%, transparent 66%, rgba(214,90,50,.22) 84%, transparent 100%)",
          boxShadow: compact
            ? "0 -8px 22px 5px rgba(243,228,195,.055)"
            : "0 -16px 42px 9px rgba(243,228,195,.065)",
          opacity: finale ? 0.78 : 0.62,
        }}
      />
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={layer({ opacity: compact ? 0.3 : 0.42 })}
      >
        <path d={silhouette} fill="#071014" />
        {!compact && (
          <g fill="none" stroke="#F3E4C3" strokeWidth="1.25" opacity=".13">
            <path d="M-20 669H238M280 669H548M610 669H918M972 669H1300" />
            <path d="M-20 682H172M222 682H486M552 682H804M868 682H1090M1146 682H1300" />
            <path d="M-20 695H126M188 695H394M460 695H710M776 695H1008M1070 695H1300" />
          </g>
        )}
      </svg>
    </div>
  );
}

function FridayNightHashes({ compact }: { compact: boolean }) {
  const marks = compact
    ? [[8, 30], [42, 58], [318, 334], [346, 372]]
    : [
        [24, 60], [92, 126], [166, 202], [242, 278], [322, 358], [402, 438],
        [842, 878], [922, 958], [1002, 1038], [1082, 1118], [1162, 1198], [1230, 1266],
      ];
  const viewWidth = compact ? 380 : 1280;
  const viewHeight = compact ? 760 : 720;
  const firstY = compact ? 730 : 704;
  const secondY = compact ? 748 : 716;

  return (
    <svg
      data-testid="september-friday-night-hashes"
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={layer({ opacity: compact ? 0.34 : 0.3 })}
    >
      <g stroke="#F3E4C3" strokeLinecap="round" strokeWidth={compact ? 1.2 : 1.6} opacity=".42">
        {marks.map(([start, end]) => (
          <g key={`${start}-${end}`}>
            <path d={`M${start} ${firstY}H${end}`} />
            <path d={`M${start + 7} ${secondY}H${end - 5}`} />
          </g>
        ))}
      </g>
    </svg>
  );
}

export function SeptemberFront({
  intensity = 1,
  compact = false,
  substrate = true,
  page,
}: SeptemberFrontProps) {
  const reduced = usePrefersReducedMotion();
  if (intensity <= 0 || !substrate) return null;

  const quiet = page === "question";
  const balanced = page === "board" || page === "leaderboard" || page === "intermission";
  const clear = page === "finale";
  const strength = Math.min(1, 0.68 + intensity * 0.12);
  const showMotion = !reduced && !compact && !quiet;
  const airMasses = compact
    ? "radial-gradient(112% 58% at -14% -7%, rgba(114,184,176,.58), transparent 60%)," +
      "radial-gradient(104% 58% at 116% 108%, rgba(214,90,50,.52), transparent 61%)," +
      "linear-gradient(132deg, rgba(34,84,88,.44) 0%, rgba(19,33,38,.04) 51%, rgba(98,47,31,.34) 100%)"
    : quiet
      ? "radial-gradient(104% 90% at -8% -12%, rgba(114,184,176,.34), transparent 63%)," +
        "radial-gradient(92% 78% at 112% 112%, rgba(214,90,50,.34), transparent 66%)," +
        "linear-gradient(132deg, rgba(34,84,88,.34) 0%, rgba(19,33,38,.08) 48%, rgba(98,47,31,.22) 100%)"
      : clear
        ? "radial-gradient(126% 112% at -8% -10%, rgba(114,184,176,.58), transparent 74%)," +
          "radial-gradient(70% 62% at 113% 112%, rgba(214,90,50,.24), transparent 64%)," +
          "linear-gradient(132deg, rgba(34,84,88,.48) 0%, rgba(19,33,38,.06) 66%, rgba(98,47,31,.18) 100%)"
        : balanced
          ? "radial-gradient(112% 100% at -8% -10%, rgba(114,184,176,.5), transparent 67%)," +
            "radial-gradient(94% 84% at 112% 112%, rgba(214,90,50,.43), transparent 68%)," +
            "linear-gradient(132deg, rgba(34,84,88,.42) 0%, rgba(19,33,38,.05) 50%, rgba(98,47,31,.31) 100%)"
          : "radial-gradient(108% 94% at -8% -12%, rgba(114,184,176,.48), transparent 64%)," +
            "radial-gradient(92% 78% at 112% 112%, rgba(214,90,50,.5), transparent 64%)," +
            "linear-gradient(132deg, rgba(34,84,88,.4) 0%, rgba(19,33,38,.06) 48%, rgba(98,47,31,.34) 100%)";

  return (
    <div
      data-testid="september-front"
      data-compact={compact ? "true" : "false"}
      data-intensity={intensity}
      data-atmosphere={quiet ? "quiet" : "open"}
      data-front-phase={compact ? "compact" : clear ? "clear" : balanced ? "balanced" : quiet ? "quiet" : "arrival"}
      aria-hidden="true"
      style={layer({ overflow: "hidden", opacity: strength })}
    >
      {/* Two temperatures in one evening: cool relief entering from above,
          with the last stored heat compressed into the opposite horizon. */}
      <div
        data-testid="september-front-air-masses"
        style={layer({
          background: airMasses,
        })}
      />

      {/* The front is a broad feathered field, never a sharp line or a
          one-way sweep that could be mistaken for time/progress. */}
      <div
        data-testid="september-front-boundary"
        style={{
          position: "absolute",
          left: compact ? "-42%" : "-27%",
          top: compact ? "23%" : "14%",
          width: compact ? "170%" : "150%",
          height: compact ? "31%" : "38%",
          transform: "rotate(-7deg)",
          background:
            "linear-gradient(180deg, transparent 0%, rgba(114,184,176,.08) 30%, rgba(243,228,195,.075) 50%, rgba(214,90,50,.07) 70%, transparent 100%)",
          filter: compact ? "blur(16px)" : "blur(26px)",
          opacity: quiet ? 0.28 : compact ? 0.78 : clear ? 0.82 : 0.74,
          pointerEvents: "none",
        }}
      />

      {!quiet && <DistantStadium compact={compact} finale={clear} />}
      {!quiet && <FridayNightHashes compact={compact} />}
      {compact ? <CompactPressureEdge /> : <Contours quiet={quiet} />}

      {showMotion && (
        <div
          data-testid="september-front-wind-veil"
          style={{
            position: "absolute",
            left: "-32%",
            top: "15%",
            width: "165%",
            height: "36%",
            transform: "rotate(-7deg)",
            background:
              "linear-gradient(180deg, transparent 8%, rgba(114,184,176,.12) 38%, rgba(243,228,195,.055) 54%, transparent 84%)",
            filter: "blur(30px)",
            animation: "tr1via-september-front-drift 21s ease-in-out infinite alternate",
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
