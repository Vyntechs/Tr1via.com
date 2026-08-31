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
  /** The theme gallery needs a card-safe stadium composition of its own. */
  surface?: "game" | "card";
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

function LampHead({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  const width = 104 * scale;
  const height = 58 * scale;
  return (
    <g
      data-testid="september-stadium-lamp-head"
      style={{ filter: `drop-shadow(0 0 ${18 * scale}px rgba(243,228,195,.72))` }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={5 * scale}
        fill="#071014"
        stroke="#F3E4C3"
        strokeOpacity=".62"
        strokeWidth={1.8 * scale}
      />
      {Array.from({ length: 12 }, (_, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        return (
          <rect
            key={index}
            x={x + (12 + column * 23) * scale}
            y={y + (10 + row * 16) * scale}
            width={12 * scale}
            height={8 * scale}
            rx={2 * scale}
            fill="#FFF4D5"
            opacity=".9"
          />
        );
      })}
    </g>
  );
}

function DistantStadium({
  compact,
  card,
  finale,
  quiet,
  resultsSafe,
}: {
  compact: boolean;
  card: boolean;
  finale: boolean;
  quiet: boolean;
  resultsSafe: boolean;
}) {
  const mode = card ? "card" : compact ? "compact" : quiet ? "quiet" : resultsSafe ? "results-safe" : "full";
  const viewWidth = compact ? 380 : 1280;
  const viewHeight = card ? 380 : compact ? 760 : 720;
  const glow = card
    ? "radial-gradient(ellipse 22% 25% at 0% 22%, rgba(243,228,195,.52), transparent 66%)," +
      "radial-gradient(ellipse 22% 25% at 100% 22%, rgba(214,90,50,.45), transparent 66%)," +
      "radial-gradient(ellipse 70% 18% at 50% 78%, rgba(114,184,176,.24), transparent 68%)"
    : compact
    ? "radial-gradient(ellipse 22% 18% at 0% 78%, rgba(243,228,195,.4), transparent 64%)," +
      "radial-gradient(ellipse 22% 18% at 100% 78%, rgba(214,90,50,.34), transparent 64%)"
    : quiet
      ? "radial-gradient(ellipse 22% 34% at 5% 27%, rgba(243,228,195,.28), transparent 64%)," +
        "radial-gradient(ellipse 22% 34% at 95% 27%, rgba(214,90,50,.24), transparent 64%)"
      : "radial-gradient(ellipse 25% 38% at 7% 22%, rgba(243,228,195,.46), transparent 62%)," +
        "radial-gradient(ellipse 25% 38% at 93% 22%, rgba(214,90,50,.4), transparent 62%)";

  return (
    <div
      data-testid="september-distant-stadium"
      data-stadium-mode={mode}
      style={layer({ overflow: "hidden" })}
    >
      <div
        data-testid="september-stadium-horizon-glow"
        style={layer({
          background: glow,
          mixBlendMode: "screen",
          opacity: finale ? 0.94 : card ? 0.88 : compact ? 0.62 : quiet ? 0.54 : 0.82,
        })}
      />
      <div
        data-testid="september-stadium-light-haze"
        style={{
          position: "absolute",
          left: compact ? "3%" : "1%",
          right: compact ? "3%" : "1%",
          bottom: card ? "23%" : compact ? "4%" : quiet ? "7.2%" : "8.4%",
          height: compact ? 1 : 2,
          background:
            "linear-gradient(90deg, transparent, rgba(243,228,195,.48) 14%, rgba(114,184,176,.28) 50%, rgba(214,90,50,.42) 86%, transparent)",
          boxShadow: compact
            ? "0 -8px 24px 7px rgba(243,228,195,.08)"
            : "0 -18px 54px 16px rgba(243,228,195,.1)",
          opacity: finale ? 0.9 : quiet ? 0.42 : 0.72,
        }}
      />
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={layer({ opacity: card ? 0.9 : compact ? 0.72 : quiet ? 0.58 : 0.92 })}
      >
        {card ? (
          <>
            <g data-testid="september-stadium-lights" fill="none" stroke="#F3E4C3" strokeOpacity=".58">
              <path d="M2 312V104M12 312V104M368 312V104M378 312V104" strokeWidth="1.6" />
              <path d="M2 286 12 256 2 226 12 196 2 166 12 136M378 286 368 256 378 226 368 196 378 166 368 136" strokeWidth="1" />
              <LampHead x={-30} y={68} scale={0.58} />
              <LampHead x={350} y={68} scale={0.58} />
            </g>
            <g data-testid="september-stadium-bowl">
              <path d="M-12 380V306Q86 282 155 277H225Q294 282 392 306V380Z" fill="#071014" opacity=".9" />
              <path data-testid="september-stadium-press-box" d="M144 278V256H236V278Z" fill="#0A171B" stroke="#F3E4C3" strokeOpacity=".5" strokeWidth="1.2" />
              <path d="M18 304Q190 263 362 304M8 319Q190 282 372 319" fill="none" stroke="#F3E4C3" strokeOpacity=".34" strokeWidth="1.3" />
            </g>
            <path data-testid="september-stadium-field" d="M0 348H380V380H0Z" fill="#102B2B" opacity=".88" />
          </>
        ) : compact ? (
          <>
            <g data-testid="september-stadium-lights" fill="none" stroke="#F3E4C3" strokeOpacity=".44">
              <path d="M4 742V610M14 742V610M366 742V610M376 742V610" strokeWidth="1.4" />
              <path d="M4 730 14 706 4 682 14 658 4 634M376 730 366 706 376 682 366 658 376 634" strokeWidth="1" />
            </g>
            <g data-testid="september-stadium-bowl">
              <path d="M-20 760V738Q94 716 160 710H220Q286 716 400 738V760Z" fill="#071014" opacity=".84" />
              <path d="M8 730Q190 696 372 730M2 744Q190 714 378 744" fill="none" stroke="#F3E4C3" strokeOpacity=".24" strokeWidth="1.2" />
            </g>
            <path data-testid="september-stadium-field" d="M0 742H380V760H0Z" fill="#102B2B" opacity=".82" />
          </>
        ) : quiet ? (
          <>
            <g data-testid="september-stadium-lights" fill="none" stroke="#F3E4C3" strokeOpacity=".4">
              <path d="M24 684V230M44 684V230M1236 684V230M1256 684V230" strokeWidth="2" />
              <path d="M24 620 44 575 24 530 44 485 24 440 44 395M1256 620 1236 575 1256 530 1236 485 1256 440 1236 395" strokeWidth="1.4" />
              <LampHead x={-18} y={190} scale={0.78} />
              <LampHead x={1218} y={190} scale={0.78} />
            </g>
            <g data-testid="september-stadium-bowl">
              <path d="M-30 720V676Q300 650 560 660H720Q980 650 1310 676V720Z" fill="#071014" opacity=".78" />
            </g>
          </>
        ) : (
          <>
            <g data-testid="september-stadium-lights" fill="none" stroke="#F3E4C3" strokeOpacity=".6">
              <path d="M34 650V206M54 650V206M1226 650V206M1246 650V206" strokeWidth="2.4" />
              <path d="M34 605 54 560 34 515 54 470 34 425 54 380 34 335 54 290M1246 605 1226 560 1246 515 1226 470 1246 425 1226 380 1246 335 1226 290" strokeWidth="1.6" />
              <LampHead x={-14} y={148} />
              <LampHead x={1190} y={148} />
            </g>
            <g data-testid="september-stadium-bowl">
              <path d="M-40 720V642Q180 610 355 580T560 548V522H720V548Q845 562 925 580T1320 642V720Z" fill="#071014" opacity=".86" />
              {!resultsSafe && (
                <g data-testid="september-stadium-bleachers" fill="none" stroke="#F3E4C3" strokeOpacity=".25" strokeWidth="1.5">
                  <path d="M80 638Q640 520 1200 638" />
                  <path d="M40 654Q640 548 1240 654" />
                  <path d="M20 672Q640 576 1260 672" />
                  <path d="M0 690Q640 604 1280 690" />
                </g>
              )}
            </g>
            <g data-testid="september-stadium-field">
              <path d="M0 660H1280V720H0Z" fill="#102B2B" opacity=".84" />
              <path d="M0 660H1280" stroke="#F3E4C3" strokeOpacity=".42" strokeWidth="2" />
              {!resultsSafe && (
                <path data-testid="september-stadium-perspective-lines" d="M90 720 410 660M1190 720 870 660" stroke="#72B8B0" strokeOpacity=".28" strokeWidth="2" />
              )}
            </g>
          </>
        )}
      </svg>
    </div>
  );
}

function FridayNightHashes({ compact }: { compact: boolean }) {
  const marks = compact
    ? [[12, 38], [55, 78], [302, 325], [342, 368]]
    : [
        [28, 66], [112, 150], [196, 234], [280, 318], [364, 402], [448, 486],
        [794, 832], [878, 916], [962, 1000], [1046, 1084], [1130, 1168], [1214, 1252],
      ];
  const viewWidth = compact ? 380 : 1280;
  const viewHeight = compact ? 760 : 720;
  const firstY = compact ? 724 : 676;
  const secondY = compact ? 746 : 704;

  return (
    <svg
      data-testid="september-friday-night-hashes"
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={layer({ opacity: compact ? 0.52 : 0.58 })}
    >
      <g stroke="#F3E4C3" strokeLinecap="round" strokeWidth={compact ? 1.4 : 2} opacity=".62">
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
  surface = "game",
}: SeptemberFrontProps) {
  const reduced = usePrefersReducedMotion();
  if (intensity <= 0 || !substrate) return null;

  const quiet = page === "question";
  const card = compact && surface === "card";
  const resultsSafe = page === "leaderboard" || page === "intermission" || page === "finale";
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

      <DistantStadium compact={compact} card={card} finale={clear} quiet={quiet} resultsSafe={resultsSafe} />
      {!quiet && !resultsSafe && !card && <FridayNightHashes compact={compact} />}
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
