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
import { SeptemberHomecomingDrift } from "./SeptemberHomecomingDrift";
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

function LampHeadArtwork() {
  return (
    <>
      <rect
        x="0"
        y="0"
        width="104"
        height="58"
        rx="5"
        fill="#071014"
        stroke="#F3E4C3"
        strokeOpacity=".62"
        strokeWidth="1.8"
      />
      {Array.from({ length: 12 }, (_, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        return (
          <rect
            key={index}
            x={12 + column * 23}
            y={10 + row * 16}
            width="12"
            height="8"
            rx="2"
            fill="#FFF4D5"
            opacity=".9"
          />
        );
      })}
    </>
  );
}

function LampHead({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g
      data-testid="september-stadium-lamp-head"
      transform={`translate(${x} ${y}) scale(${scale})`}
      style={{ filter: `drop-shadow(0 0 ${18 * scale}px rgba(243,228,195,.72))` }}
    >
      <LampHeadArtwork />
    </g>
  );
}

function CompactLampHead({ side, quiet }: { side: "left" | "right"; quiet: boolean }) {
  const edge = side === "left" ? { left: 0 } : { right: 0 };
  return (
    <svg
      data-testid="september-stadium-lamp-head"
      data-side={side}
      viewBox="0 0 104 58"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      style={{
        position: "absolute",
        // A question's opaque category banner owns the first 89px. Place quiet
        // lamps immediately beneath it; the solid housing masks the tower lines
        // behind it, so they still read as one fixture. Open compact screens keep
        // the housing bottom tied to the original tower top. In both cases height
        // derives from the desktop 104:58 artwork, never the stretched scene SVG.
        top: quiet ? 89 : undefined,
        bottom: quiet ? undefined : "87.97%",
        width: "18.61%",
        height: "auto",
        aspectRatio: "104 / 58",
        opacity: quiet ? 0.78 : 0.9,
        overflow: "visible",
        pointerEvents: "none",
        filter: "drop-shadow(0 0 12.24px rgba(243,228,195,.72))",
        ...edge,
      }}
    >
      <LampHeadArtwork />
    </svg>
  );
}

function StadiumLightBeams({ compact, quiet = false }: { compact: boolean; quiet?: boolean }) {
  return (
    <g data-testid="september-stadium-light-beams" fill="#FFF4D5" opacity={quiet ? ".52" : "1"}>
      {compact ? (
        <>
          <path d="M18 86 154 672H62Z" opacity=".055" />
          <path d="M362 86 318 672H226Z" opacity=".052" />
          <path d="M34 88 112 620H76Z" opacity=".04" />
          <path d="M346 88 304 620H268Z" opacity=".038" />
        </>
      ) : (
        <>
          <path d="M18 178 470 668H128Z" opacity=".055" />
          <path d="M1262 178 810 668H1152Z" opacity=".052" />
        </>
      )}
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
    ? "radial-gradient(ellipse 38% 24% at 0% 14%, rgba(243,228,195,.48), transparent 65%)," +
      "radial-gradient(ellipse 38% 24% at 100% 14%, rgba(214,90,50,.42), transparent 65%)," +
      "radial-gradient(ellipse 80% 20% at 50% 94%, rgba(114,184,176,.2), transparent 70%)"
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
          opacity: finale ? 0.94 : card ? 0.88 : compact ? 0.86 : quiet ? 0.54 : 0.88,
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
        style={layer({ opacity: card ? 0.9 : compact ? (quiet ? 0.78 : 0.9) : quiet ? 0.58 : 0.96 })}
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
              <path
                data-testid="september-stadium-press-box"
                d="M18 286V280H132V272H144V254H236V272H248V280H362V286Z"
                fill="#102B2B"
                opacity=".54"
              />
            </g>
            <path data-testid="september-stadium-field" d="M18 288H362" fill="none" stroke="#72B8B0" strokeOpacity=".28" strokeWidth="1.2" />
          </>
        ) : compact ? (
          <>
            <StadiumLightBeams compact quiet={quiet} />
            <g data-testid="september-stadium-lights" fill="none" stroke="#F3E4C3" strokeOpacity={quiet ? ".4" : ".54"}>
              <path d="M3 742 14 94M22 742 30 94M377 742 366 94M358 742 350 94" strokeWidth="1.45" />
              <path d="M4 688 21 642 6 596 23 550 8 504 24 458 10 412 26 366 12 320 27 274 14 228 29 182M376 688 359 642 374 596 357 550 372 504 356 458 370 412 354 366 368 320 353 274 366 228 351 182" strokeWidth=".9" />
            </g>
            {quiet ? (
              <g data-testid="september-stadium-bowl">
                <path d="M0 728H380" fill="none" stroke="#72B8B0" strokeOpacity=".2" strokeWidth="1" />
              </g>
            ) : (
              <>
                <g data-testid="september-stadium-bowl">
                  <path data-testid="september-stadium-bleachers" d="M0 726V714H70V707H128V726ZM252 726V707H310V714H380V726Z" fill="#102B2B" opacity=".48" />
                  <g data-testid="september-homecoming-pennants">
                    <path d="M106 661Q190 673 274 661" fill="none" stroke="#F3E4C3" strokeOpacity=".42" strokeWidth="1" />
                    <path d="m119 663 7 13 7-11m19 3 7 13 7-11m19 1 7 13 7-13m19-1 7 11 7-13m19-3 7 11 7-13" fill="#D65A32" opacity=".76" />
                    <path d="m135 666 7 12 7-10m19 2 7 12 7-11m19 0 7 11 7-12m19-2 7 10 7-12" fill="#72B8B0" opacity=".74" />
                  </g>
                  <text
                    data-testid="september-homecoming-sign"
                    x="190"
                    y="696"
                    textAnchor="middle"
                    fill="#F3E4C3"
                    fillOpacity=".5"
                    fontSize="7"
                    fontWeight="700"
                    letterSpacing="2.2"
                  >
                    HOMECOMING
                  </text>
                </g>
                <g data-testid="september-stadium-goal-post" fill="none" stroke="#E2B94F" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M190 724V678M151 678H229M160 678V610M220 678V610" stroke="#FFF1B8" strokeOpacity=".18" strokeWidth="6.5" />
                  <path d="M190 724V678M151 678H229M160 678V610M220 678V610" strokeOpacity=".86" strokeWidth="3.2" />
                </g>
                <path data-testid="september-stadium-field" d="M0 728H380" fill="none" stroke="#72B8B0" strokeOpacity=".4" strokeWidth="1.5" />
              </>
            )}
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
              <path d="M0 650H1280V658H0Z" fill="#102B2B" opacity=".3" />
            </g>
          </>
        ) : (
          <>
            <StadiumLightBeams compact={false} />
            <g data-testid="september-stadium-lights" fill="none" stroke="#F3E4C3" strokeOpacity=".6">
              <path d="M34 650V206M54 650V206M1226 650V206M1246 650V206" strokeWidth="2.4" />
              <path d="M34 605 54 560 34 515 54 470 34 425 54 380 34 335 54 290M1246 605 1226 560 1246 515 1226 470 1246 425 1226 380 1246 335 1226 290" strokeWidth="1.6" />
              <LampHead x={-14} y={148} />
              <LampHead x={1190} y={148} />
            </g>
            <g data-testid="september-stadium-bowl">
              <path
                data-testid="september-stadium-silhouette"
                d={resultsSafe
                  ? "M0 650H1280V658H0Z"
                  : "M0 657V648H180V638H410V628H545V616H735V628H870V638H1100V648H1280V657Z"}
                fill="#102B2B"
                opacity={resultsSafe ? ".3" : ".62"}
              />
              {!resultsSafe && (
                <>
                  <path data-testid="september-stadium-bleachers" d="M80 638H420M126 628H456M860 638H1200M824 628H1154" fill="none" stroke="#F3E4C3" strokeOpacity=".14" strokeWidth="2" />
                  <path data-testid="september-stadium-press-box" d="M545 616V586H735V616Z" fill="#071014" opacity=".7" />
                </>
              )}
            </g>
            {!resultsSafe && (
              <g data-testid="september-stadium-goal-post" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M640 654V584M590 584H690M606 584V500M674 584V500" stroke="#FFF1B8" strokeOpacity=".14" strokeWidth="8" />
                <path d="M640 654V584M590 584H690M606 584V500M674 584V500" stroke="#D7A84D" strokeOpacity=".58" strokeWidth="3.4" />
              </g>
            )}
            <g data-testid="september-stadium-field">
              <path d="M0 658H1280" stroke="#72B8B0" strokeOpacity=".26" strokeWidth="2" />
            </g>
          </>
        )}
      </svg>
      {compact && !card && (
        <>
          <CompactLampHead side="left" quiet={quiet} />
          <CompactLampHead side="right" quiet={quiet} />
        </>
      )}
    </div>
  );
}

function FridayNightHashes() {
  const marks = [
    [28, 66], [112, 150], [196, 234], [280, 318], [364, 402], [448, 486],
    [794, 832], [878, 916], [962, 1000], [1046, 1084], [1130, 1168], [1214, 1252],
  ];

  return (
    <svg
      data-testid="september-friday-night-hashes"
      viewBox="0 0 1280 720"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={layer({ opacity: 0.5 })}
    >
      <g stroke="#F3E4C3" strokeLinecap="round" strokeWidth="2" opacity=".54">
        {marks.map(([start, end]) => (
          <g key={`${start}-${end}`}>
            <path d={`M${start} 630H${end}`} />
            <path d={`M${start + 7} 646H${end - 5}`} />
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
      <SeptemberHomecomingDrift
        animated={showMotion}
        compact={compact}
        card={card}
        quiet={quiet}
      />
      {!quiet && !resultsSafe && !card && !compact && <FridayNightHashes />}
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
