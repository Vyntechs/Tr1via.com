// September's local memory layer: early-turn leaves, footballs, and
// homecoming pom-poms caught in the first cool breeze.
//
// Football and cheer carry the first read; leaves support them without taking
// over the screen. Open game surfaces let the keepsakes fall, including narrow
// host and player layouts. Questions, theme cards, and reduced-motion surfaces
// hold a sparse static composition at the edges.

import type { CSSProperties } from "react";

type KeepsakeKind = "leaf" | "football" | "pom";

interface Keepsake {
  id: string;
  kind: KeepsakeKind;
  left: number;
  compactLeft?: number;
  staticTop: number;
  quietLeft?: number;
  quietTop?: number;
  compactQuietLeft?: number;
  compactQuietTop?: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  opacity: number;
  rotate: number;
  tone: "clay" | "gold" | "olive" | "cool";
}

const KEEPSAKES: Keepsake[] = [
  // The first football and pom are deterministic first-frame anchors. Their
  // negative delays place them well inside the viewport on mount, and their
  // opacity remains >= .32 after the setup overview's .5 weather veil.
  { id: "ball-1", kind: "football", left: 8,  compactLeft: 72, staticTop: 21, quietLeft: 2,  quietTop: 50, compactQuietLeft: 76, compactQuietTop: 68, size: 44, duration: 22, delay: 7,  drift: 34,  opacity: 0.94, rotate: -14, tone: "clay" },
  { id: "pom-1",  kind: "pom",      left: 22, compactLeft: 74, staticTop: 70, quietLeft: 94, quietTop: 54, compactQuietLeft: 82, compactQuietTop: 82, size: 48, duration: 20, delay: 12, drift: -30, opacity: 0.92, rotate: -15, tone: "cool" },
  { id: "leaf-1", kind: "leaf",     left: 12, staticTop: 47, size: 27, duration: 25, delay: 17, drift: -46, opacity: 0.56, rotate: 24,  tone: "olive" },
  { id: "pom-2",  kind: "pom",      left: 48, staticTop: 14, size: 46, duration: 24, delay: 5,  drift: 42,  opacity: 0.88, rotate: 18,  tone: "clay" },
  { id: "ball-2", kind: "football", left: 61, staticTop: 56, size: 42, duration: 27, delay: 18, drift: -38, opacity: 0.9,  rotate: 13,  tone: "clay" },
  { id: "leaf-2", kind: "leaf",     left: 38, staticTop: 86, size: 24, duration: 28, delay: 9,  drift: 38,  opacity: 0.5,  rotate: -34, tone: "clay" },
  { id: "pom-3",  kind: "pom",      left: 76, staticTop: 83, size: 44, duration: 23, delay: 16, drift: -34, opacity: 0.9,  rotate: 24,  tone: "cool" },
  { id: "leaf-3", kind: "leaf",     left: 70, staticTop: 31, size: 30, duration: 30, delay: 21, drift: 50,  opacity: 0.54, rotate: 31,  tone: "gold" },
  { id: "ball-3", kind: "football", left: 82, staticTop: 24, size: 40, duration: 25, delay: 10, drift: 29,  opacity: 0.88, rotate: -20, tone: "clay" },
  { id: "pom-4",  kind: "pom",      left: 88, staticTop: 62, size: 46, duration: 26, delay: 19, drift: -27, opacity: 0.9,  rotate: -29, tone: "clay" },
  { id: "leaf-4", kind: "leaf",     left: 94, staticTop: 42, size: 25, duration: 26, delay: 13, drift: -31, opacity: 0.52, rotate: 17,  tone: "olive" },
];

const CARD_IDS = new Set(["ball-1", "pom-1", "leaf-1", "leaf-4"]);
const QUIET_IDS = new Set(["ball-1", "pom-1"]);
const COMPACT_IDS = new Set(["ball-1", "pom-1", "leaf-1", "ball-3", "pom-4", "leaf-4"]);

const LEAF_COLORS = {
  clay: "#D65A32",
  gold: "#D7A84D",
  olive: "#A7B85B",
  cool: "#72B8B0",
} as const;

function LeafKeepsake({ size, tone }: Pick<Keepsake, "size" | "tone">) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.8 3.2C13.4 3.4 6.3 6.9 3.2 13.4c-1.2 2.5-.4 5.4 2 6.7 2.2 1.4 5.2.7 6.8-1.5 3.6-5.1 5.8-9.2 8.8-15.4Z"
        fill={LEAF_COLORS[tone]}
      />
      <path d="M4.7 19.8c3.8-4.6 7.7-8.1 12.7-11.5" fill="none" stroke="#F3E4C3" strokeOpacity=".42" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function FootballKeepsake({ size }: Pick<Keepsake, "size">) {
  return (
    <svg width={size * 1.55} height={size} viewBox="0 0 40 26" aria-hidden="true">
      <path
        d="M2 13C7.5 4.4 13.4 1 20 1s12.5 3.4 18 12c-5.5 8.6-11.4 12-18 12S7.5 21.6 2 13Z"
        fill="#A34E2C"
        stroke="#F7E8C4"
        strokeWidth="1.8"
      />
      <path d="M9 6.2c2.1 4.4 2.1 9.2 0 13.6M31 6.2c-2.1 4.4-2.1 9.2 0 13.6" fill="none" stroke="#F7E8C4" strokeWidth="2.3" />
      <path d="M14 13h12m-9-3v6m3-6v6m3-6v6" fill="none" stroke="#F7E8C4" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function PomKeepsake({ size, tone }: Pick<Keepsake, "size" | "tone">) {
  const color = tone === "cool" ? "#72B8B0" : "#D65A32";
  const contrast = tone === "cool" ? "#D65A32" : "#72B8B0";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g fill="none" stroke={color} strokeWidth="3.4" strokeLinecap="round">
        <path d="M16 17 3 5m13 12L9 2m7 15L16 1m0 16L24 3m-8 14L30 7m-14 10 15-2m-15 2L3 12m13 5L2 20" />
      </g>
      <g fill="none" stroke={contrast} strokeWidth="2.7" strokeLinecap="round">
        <path d="M16 17 5 9m11 8-2-14m2 14L29 3M16 17l13 4M16 17 7 25" />
      </g>
      <g fill="#F3E4C3" fillOpacity=".88">
        <circle cx="3" cy="5" r="1.7" /><circle cx="16" cy="1" r="1.7" /><circle cx="30" cy="7" r="1.7" /><circle cx="31" cy="15" r="1.7" /><circle cx="2" cy="20" r="1.7" />
      </g>
      <circle cx="16" cy="17" r="3.6" fill="#F3E4C3" />
      <path d="M13.2 19.5h5.6l1.6 10.8h-8.8Z" fill="#D7A84D" stroke="#F3E4C3" strokeOpacity=".72" strokeWidth="1" />
    </svg>
  );
}

function KeepsakeGlyph({ keepsake }: { keepsake: Keepsake }) {
  if (keepsake.kind === "football") return <FootballKeepsake size={keepsake.size} />;
  if (keepsake.kind === "pom") return <PomKeepsake size={keepsake.size} tone={keepsake.tone} />;
  return <LeafKeepsake size={keepsake.size} tone={keepsake.tone} />;
}

export function SeptemberHomecomingDrift({
  animated,
  compact,
  card,
  quiet,
}: {
  animated: boolean;
  compact: boolean;
  card: boolean;
  quiet: boolean;
}) {
  const visible = KEEPSAKES.filter((keepsake) => {
    if (card) return CARD_IDS.has(keepsake.id);
    if (quiet) return QUIET_IDS.has(keepsake.id);
    if (compact) return COMPACT_IDS.has(keepsake.id);
    return true;
  });

  return (
    <div
      data-testid="september-homecoming-drift"
      data-motion={animated ? "falling" : "static"}
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      {visible.map((keepsake) => {
        const surfaceOpacity = quiet ? 0.78 : card ? 0.86 : compact && keepsake.kind === "leaf" ? 0.92 : 1;
        const opacity = keepsake.opacity * surfaceOpacity;
        if (!animated) {
          const staticLeft = quiet
            ? compact
              ? keepsake.compactQuietLeft ?? keepsake.quietLeft ?? keepsake.left
              : keepsake.quietLeft ?? keepsake.left
            : keepsake.left;
          const staticTop = quiet
            ? compact
              ? keepsake.compactQuietTop ?? keepsake.quietTop ?? keepsake.staticTop
              : keepsake.quietTop ?? keepsake.staticTop
            : keepsake.staticTop;
          return (
            <div
              key={keepsake.id}
              data-testid={`september-homecoming-${keepsake.kind}`}
              data-keepsake-id={keepsake.id}
              style={{
                position: "absolute",
                left: `${staticLeft}%`,
                top: `${staticTop}%`,
                width: keepsake.size * (keepsake.kind === "football" ? 1.55 : 1.35),
                height: keepsake.size,
                opacity,
                transform: `rotate(${keepsake.rotate}deg)`,
              }}
            >
              <KeepsakeGlyph keepsake={keepsake} />
            </div>
          );
        }

        return (
          <div
            key={keepsake.id}
            data-testid={`september-homecoming-${keepsake.kind}`}
            data-keepsake-id={keepsake.id}
            className="tr1via-september-keepsake-rail"
            style={{
              position: "absolute",
              left: `${compact ? keepsake.compactLeft ?? keepsake.left : keepsake.left}%`,
              // A compact host page can be much taller than its viewport. Tie
              // the loop to the visible screen so first-read keepsakes do not
              // spend their whole cycle below the fold.
              top: compact ? "-14dvh" : "-14%",
              width: keepsake.size * (keepsake.kind === "football" ? 1.55 : 1.35),
              height: compact ? "128dvh" : "128%",
              opacity,
              animation: `tr1via-september-keepsake-fall ${keepsake.duration}s linear ${-keepsake.delay}s infinite`,
              ["--sept-drift" as string]: `${keepsake.drift}px`,
            } as CSSProperties}
          >
            <div
              className={`tr1via-september-keepsake-glyph tr1via-september-keepsake-${keepsake.kind}`}
              style={{
                width: keepsake.size * (keepsake.kind === "football" ? 1.55 : 1.35),
                height: keepsake.size,
                animation: keepsake.kind === "football"
                  ? "tr1via-september-football-rock 4.8s ease-in-out infinite alternate"
                  : keepsake.kind === "pom"
                    ? "tr1via-september-pom-flutter 4.2s ease-in-out infinite alternate"
                    : "tr1via-september-keepsake-flutter 7.4s ease-in-out infinite alternate",
                ["--sept-tilt" as string]: `${keepsake.rotate}deg`,
              } as CSSProperties}
            >
              <KeepsakeGlyph keepsake={keepsake} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
