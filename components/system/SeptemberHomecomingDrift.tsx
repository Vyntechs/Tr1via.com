// September's local memory layer: early-turn leaves, a couple of tiny
// footballs, and homecoming pom-poms caught in the first cool breeze.
//
// The mix is intentionally leaf-heavy. Football and cheer are details people
// notice on a second look, not clip art competing with the game. Full-size
// ambient screens let the keepsakes fall; questions, phones, theme cards, and
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
  { id: "leaf-1", kind: "leaf", left: 4,  staticTop: 15, size: 15, duration: 27, delay: 6,  drift: 38,  opacity: 0.42, rotate: -28, tone: "olive" },
  { id: "leaf-2", kind: "leaf", left: 13, staticTop: 72, size: 19, duration: 34, delay: 24, drift: -54, opacity: 0.34, rotate: 24,  tone: "clay" },
  { id: "pom-1",  kind: "pom",  left: 22, staticTop: 8,  size: 18, duration: 38, delay: 16, drift: 46,  opacity: 0.32, rotate: -15, tone: "cool" },
  { id: "leaf-3", kind: "leaf", left: 30, staticTop: 84, size: 13, duration: 25, delay: 19, drift: -28, opacity: 0.38, rotate: 42,  tone: "gold" },
  { id: "ball-1", kind: "football", left: 39, staticTop: 18, size: 19, duration: 43, delay: 31, drift: 34, opacity: 0.29, rotate: -18, tone: "clay" },
  { id: "leaf-4", kind: "leaf", left: 47, staticTop: 66, size: 17, duration: 31, delay: 12, drift: -42, opacity: 0.33, rotate: 16,  tone: "olive" },
  { id: "leaf-5", kind: "leaf", left: 56, staticTop: 10, size: 14, duration: 29, delay: 22, drift: 48,  opacity: 0.4,  rotate: -38, tone: "clay" },
  { id: "pom-2",  kind: "pom",  left: 64, staticTop: 88, size: 20, duration: 41, delay: 8,  drift: -36, opacity: 0.28, rotate: 22,  tone: "clay" },
  { id: "leaf-6", kind: "leaf", left: 72, staticTop: 28, size: 18, duration: 36, delay: 27, drift: 56,  opacity: 0.35, rotate: 31,  tone: "gold" },
  { id: "ball-2", kind: "football", left: 80, staticTop: 76, size: 17, duration: 46, delay: 18, drift: -31, opacity: 0.27, rotate: 19,  tone: "clay" },
  { id: "leaf-7", kind: "leaf", left: 88, staticTop: 13, size: 12, duration: 26, delay: 10, drift: -47, opacity: 0.4,  rotate: -21, tone: "olive" },
  { id: "pom-3",  kind: "pom",  left: 95, staticTop: 58, size: 16, duration: 39, delay: 33, drift: 27,  opacity: 0.3,  rotate: -29, tone: "cool" },
  { id: "leaf-8", kind: "leaf", left: 8,  staticTop: 91, size: 12, duration: 24, delay: 14, drift: 25,  opacity: 0.36, rotate: 34,  tone: "gold" },
  { id: "leaf-9", kind: "leaf", left: 92, staticTop: 37, size: 16, duration: 33, delay: 26, drift: -35, opacity: 0.33, rotate: 17,  tone: "clay" },
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
    <svg width={size * 1.35} height={size} viewBox="0 0 30 20" aria-hidden="true">
      <path d="M2.2 10C5.3 2.3 13.5.2 27.8 2.4 24.7 10.1 16.5 19.8 2.2 17.6 4.3 14.7 4.3 7.2 2.2 10Z" fill="#9F4E2E" stroke="#F3E4C3" strokeOpacity=".7" strokeWidth="1.2" />
      <path d="m12.2 6.4 5.5 7.2M12.5 8.1l1.8-1.4m.1 4 1.9-1.5m0 4 1.8-1.4" fill="none" stroke="#F3E4C3" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function PomKeepsake({ size, tone }: Pick<Keepsake, "size" | "tone">) {
  const color = tone === "cool" ? "#72B8B0" : "#D65A32";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
        <path d="M12 13 4 4m8 9L8 2m4 11L13 2m-1 11 6-9m-6 9 9-4m-9 4-9-3m9 3-4 5" />
      </g>
      <g fill="none" stroke="#F3E4C3" strokeOpacity=".86" strokeWidth="1.2" strokeLinecap="round">
        <path d="M12 13 2 7m10 6 4-11m-4 11 10-8m-10 8 8 2" />
      </g>
      <path d="M10.3 12.2h3.4l1.2 8.3h-5.8Z" fill="#D7A84D" />
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
    if (compact) return [0, 2, 4, 6, 9, 10, 13].includes(index);
    if (quiet) return [0, 3, 4, 8, 10, 13].includes(index);
    return true;
  });

  return (
    <div
      data-testid="september-homecoming-drift"
      data-motion={animated ? "falling" : "static"}
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      {visible.map((keepsake) => {
        const opacity = keepsake.opacity * (quiet ? 0.56 : compact ? 0.72 : card ? 0.8 : 1);
        if (!animated) {
          return (
            <div
              key={keepsake.id}
              data-testid={`september-homecoming-${keepsake.kind}`}
              style={{
                position: "absolute",
                left: `${keepsake.left}%`,
                top: `${keepsake.staticTop}%`,
                width: keepsake.size * 1.35,
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
              width: keepsake.size * 1.35,
              height: "128%",
              opacity,
              animation: `tr1via-september-keepsake-fall ${keepsake.duration}s linear ${-keepsake.delay}s infinite`,
              ["--sept-drift" as string]: `${keepsake.drift}px`,
            } as CSSProperties}
          >
            <div
              className={`tr1via-september-keepsake-glyph tr1via-september-keepsake-${keepsake.kind}`}
              style={{
                width: keepsake.size * 1.35,
                height: keepsake.size,
                animation: `tr1via-september-keepsake-flutter ${keepsake.kind === "football" ? 11 : keepsake.kind === "pom" ? 5.8 : 7.4}s ease-in-out infinite alternate`,
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
