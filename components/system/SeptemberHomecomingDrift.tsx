// September's local memory layer: early-turn leaves, a couple of tiny
// footballs, and homecoming pom-poms caught in the first cool breeze.
//
// The mix is intentionally leaf-heavy. Football and cheer are recognizable
// homecoming punctuation, not clip art competing with the game. Full-size
// ambient screens let the keepsakes fall; questions, theme cards, and
// reduced-motion surfaces hold a sparse static composition at the edges.

import type { CSSProperties } from "react";

type KeepsakeKind = "leaf" | "football" | "pom";

interface Keepsake {
  id: string;
  kind: KeepsakeKind;
  left: number;
  staticTop: number;
  size: number;
  duration: number;
  delay: number;
  drift: number;
  opacity: number;
  rotate: number;
  tone: "clay" | "gold" | "olive" | "cool";
}

const KEEPSAKES: Keepsake[] = [
  { id: "leaf-1", kind: "leaf", left: 4,  staticTop: 15, size: 19, duration: 27, delay: 6,  drift: 38,  opacity: 0.54, rotate: -28, tone: "olive" },
  { id: "leaf-2", kind: "leaf", left: 13, staticTop: 72, size: 27, duration: 34, delay: 24, drift: -54, opacity: 0.46, rotate: 24,  tone: "clay" },
  { id: "pom-1",  kind: "pom",  left: 8,  staticTop: 68, size: 34, duration: 38, delay: 16, drift: 46,  opacity: 0.68, rotate: -15, tone: "cool" },
  { id: "leaf-3", kind: "leaf", left: 30, staticTop: 84, size: 17, duration: 25, delay: 19, drift: -28, opacity: 0.5,  rotate: 42,  tone: "gold" },
  { id: "ball-1", kind: "football", left: 39, staticTop: 18, size: 26, duration: 43, delay: 31, drift: 34, opacity: 0.64, rotate: -14, tone: "clay" },
  { id: "leaf-4", kind: "leaf", left: 47, staticTop: 66, size: 22, duration: 31, delay: 12, drift: -42, opacity: 0.44, rotate: 16,  tone: "olive" },
  { id: "leaf-5", kind: "leaf", left: 56, staticTop: 10, size: 18, duration: 29, delay: 22, drift: 48,  opacity: 0.52, rotate: -38, tone: "clay" },
  { id: "pom-2",  kind: "pom",  left: 64, staticTop: 88, size: 32, duration: 41, delay: 8,  drift: -36, opacity: 0.6,  rotate: 22,  tone: "clay" },
  { id: "leaf-6", kind: "leaf", left: 72, staticTop: 28, size: 25, duration: 36, delay: 27, drift: 56,  opacity: 0.47, rotate: 31,  tone: "gold" },
  { id: "ball-2", kind: "football", left: 80, staticTop: 76, size: 23, duration: 46, delay: 18, drift: -31, opacity: 0.58, rotate: 16,  tone: "clay" },
  { id: "leaf-7", kind: "leaf", left: 88, staticTop: 13, size: 16, duration: 26, delay: 10, drift: -47, opacity: 0.52, rotate: -21, tone: "olive" },
  { id: "pom-3",  kind: "pom",  left: 86, staticTop: 48, size: 32, duration: 39, delay: 33, drift: 27,  opacity: 0.64, rotate: -29, tone: "cool" },
  { id: "leaf-8", kind: "leaf", left: 8,  staticTop: 91, size: 16, duration: 24, delay: 14, drift: 25,  opacity: 0.48, rotate: 34,  tone: "gold" },
  { id: "leaf-9", kind: "leaf", left: 92, staticTop: 37, size: 21, duration: 33, delay: 26, drift: -35, opacity: 0.45, rotate: 17,  tone: "clay" },
];

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
  const visible = KEEPSAKES.filter((keepsake, index) => {
    if (card) return [0, 2, 4, 6, 8, 10, 11].includes(index);
    if (quiet) return [0, 3, 8, 9, 10, 13].includes(index);
    if (compact) return [0, 2, 6, 9, 11, 13].includes(index);
    return true;
  });

  return (
    <div
      data-testid="september-homecoming-drift"
      data-motion={animated ? "falling" : "static"}
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      {visible.map((keepsake) => {
        const opacity = keepsake.opacity * (quiet ? 0.68 : card ? 0.86 : compact ? 0.92 : 1);
        if (!animated) {
          return (
            <div
              key={keepsake.id}
              data-testid={`september-homecoming-${keepsake.kind}`}
              style={{
                position: "absolute",
                left: `${keepsake.left}%`,
                top: `${keepsake.staticTop}%`,
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
            className="tr1via-september-keepsake-rail"
            style={{
              position: "absolute",
              left: `${keepsake.left}%`,
              top: "-14%",
              width: keepsake.size * (keepsake.kind === "football" ? 1.55 : 1.35),
              height: "128%",
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
                  ? "tr1via-september-football-rock 6.8s ease-in-out infinite alternate"
                  : `tr1via-september-keepsake-flutter ${keepsake.kind === "pom" ? 5.8 : 7.4}s ease-in-out infinite alternate`,
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
