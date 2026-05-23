// TV · LOCK-IN VARIANT A · THE PILE-UP — chosen choreography.
// Each name tile drops into a pile in the lower-third. Deterministic small
// rotation + x-jitter per index so the stack reads as physical, not a grid.
// The most recently landed tiles animate in with `tr1via-tile-land` (weighty,
// not bouncy — settles like a card on a table).
//
// Driven by a `tiles` prop so live data can replace the demo roster. The
// demo roster (21 names) is the default — the gallery, design package, and
// any unit tests render against it.

"use client";

import { useTheme } from "@/components/system";
import { Numeric } from "@/components/system";
import { Eyebrow } from "@/components/system";
import { categoryColor } from "@/lib/theme/categories";
import type { ThemeKey } from "@/lib/theme/tokens";
import { LockInBase } from "./LockInBase";
import { TR1VIA_LOCKIN_ROSTER, type LockInTile } from "./roster";

export interface LockInPileUpProps {
  themeKey?: ThemeKey;
  /** Locked-in players to display. Defaults to the 21-name demo roster. */
  tiles?: LockInTile[];
  /** Variant label shown along the bottom strip. */
  variantLabel?: string;
  /** Whether to render the "recommended for the venue" badge. */
  recommended?: boolean;
}

export function LockInPileUp({
  themeKey,
  tiles = TR1VIA_LOCKIN_ROSTER,
  variantLabel = "A · NAMES STACK UP",
  recommended = true,
}: LockInPileUpProps) {
  return (
    <LockInBase themeKey={themeKey} variantLabel={variantLabel} recommended={recommended}>
      <LockInPileUpBody tiles={tiles} />
    </LockInBase>
  );
}

function LockInPileUpBody({ tiles }: { tiles: LockInTile[] }) {
  const { t } = useTheme();
  const cc = categoryColor("Geography", t.accent);
  // Deterministic small rotation + slight x-jitter for the pile look.
  // (Hash so adjacent tiles differ; range matches the design source.)
  const seedRot = (i: number) => ((i * 2654435761) % 7) - 3;       // -3..+3 deg
  const seedX   = (i: number) => ((i * 16807) % 9) - 4;            // -4..+4 px
  // The most recently landed tiles animate in. The threshold is per-roster
  // so live data with N tiles still gets ~3 fresh landers at the end.
  const landThreshold = Math.max(0, tiles.length - 3);
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <Eyebrow color={t.inkMid} size={11}>{tiles.length} OF 32 LOCKED IN</Eyebrow>
        <Eyebrow color={t.inkMute} size={10}>EACH NAME LANDS LIKE A CARD ON A TABLE · WEIGHTY, NOT BOUNCY</Eyebrow>
      </div>
      <div style={{
        marginTop: 12, flex: 1, position: "relative", overflow: "hidden",
        background: t.dark ? "rgba(244,230,196,.03)" : "rgba(27,19,12,.03)",
        borderRadius: 14, padding: 16,
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignContent: "flex-end" }}>
          {tiles.map((p, i) => {
            const rot = seedRot(i);
            const x = seedX(i);
            // Settle position so tile-land's final keyframe matches the
            // permanent transform — the tile lands on its jittered spot
            // rather than snapping to (0, 0) at the end of the animation.
            const finalTransform = `translate3d(${x}px, 0, 0) rotate(${rot}deg)`;
            const animate = i >= landThreshold;
            return (
              <div
                key={p.name}
                style={{
                  padding: "7px 12px",
                  borderRadius: 8,
                  background: cc,
                  color: "#0E0805",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "-0.005em",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  transform: finalTransform,
                  boxShadow: `0 4px 10px -3px ${cc}66`,
                  // CSS custom prop lets the keyframe land at the jittered transform.
                  ...({ "--tile-final": finalTransform } as React.CSSProperties),
                  animation: animate
                    ? `tr1via-tile-land .45s cubic-bezier(.2,.7,.3,1) ${(i - landThreshold) * 80}ms both`
                    : "none",
                  outline: p.isYou ? `2px solid ${t.ink}` : "none",
                  outlineOffset: p.isYou ? 2 : 0,
                }}
              >
                {p.name}
                {p.t && (
                  <Numeric size={10} weight={600} color="rgba(14,8,5,.6)">
                    {p.t}
                  </Numeric>
                )}
              </div>
            );
          })}
          {/* The "next to land" — half-faded, mid-drop */}
          {["Hank", "Reza"].map((n) => (
            <div key={n} style={{
              padding: "7px 12px", borderRadius: 8,
              background: cc, color: "#0E0805",
              fontSize: 14, fontWeight: 700,
              transform: "translateY(-32px) scale(0.95)", opacity: 0.4,
              boxShadow: `0 8px 14px -4px ${cc}55`,
            }}>{n}</div>
          ))}
        </div>
      </div>
    </>
  );
}
