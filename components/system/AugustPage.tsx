// August — "Still Summer". One notebook, written in all night.
//
// Every other month is a palette plus falling particles. August is a
// structural change: the surface itself becomes a torn-out page from a
// spiral notebook, and the night gets written onto it in blue ballpoint.
//
// Three layers, back to front:
//   1. the page      — warm paper wash, blue ruling, red margin rule
//   2. the furniture — punch holes, torn top edge, foxed edges, landed leaves
//   3. the hand      — per-screen marginalia: tallies while the room fills,
//                      a play doodled while the question is up, the leader
//                      underlined, the winner boxed. Pressed leaves taped in
//                      accumulate as the night goes: one at the lobby, five
//                      by the finale.
//
// A fire burns just off the bottom edge: the light is low and warm and it
// breathes, the page has singed at its border, and embers climb while the
// leaves come down. That opposition — leaves falling, sparks rising — is the
// campfire, and it costs nine small dots rather than an orange repaint.
//
// The leaves are half green and half turned. That is the entire reason this
// reads as August and not October — the world stays summer, and only the
// leaves say fall. September/October/November keep their own full-autumn
// palettes untouched; nothing here spends them early.
//
// Placement rule that never bends: marginalia lives only where that screen
// has genuinely empty page. Nothing ornamental ever sits on a question, an
// answer, a verdict, the timer, or the host's lock-in counts. Anything not
// verified against a real render is simply not placed — an unknown screen
// gets the page and the leaves and no hand at all.
//
// Reduced motion drops the moving parts and keeps the page. The global CSS
// catch-all collapses every animation to 0.001ms, which does NOT freeze a
// particle where it looks right — with no fill-mode the keyframed opacity
// stops applying and each ember snaps back to full brightness, glued to the
// bottom edge, while the leaves finish off-screen and vanish. So the two
// animated layers skip render entirely, exactly as ParticleField does. What
// remains is the page itself, which is the part that carries the month.

"use client";

import { useMemo, type CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";

/** Which screen of the night this is. Drives the marginalia and how many
 *  pressed leaves have accumulated. Omit it and no marginalia is drawn. */
export type AugustPageName =
  | "lobby"
  | "board"
  | "question"
  | "reveal"
  | "leaderboard"
  | "intermission"
  | "finale";

// ─── Leaf silhouettes ────────────────────────────────────────────────────
// 64x64 viewBox, stem at the bottom, tip at the top. Drawn so the shape
// still reads at 20px on a venue TV from ten feet — the host's first note on
// the old August was that the leaves "look like little specks."

/** Sugar maple — hand-plotted, because a maple's proportions are the whole
 *  reason it's readable at a glance. */
const MAPLE =
  "M32 3 L37 17 L39 27 L46 20 L57 17 L48 30 L42 35 L52 39 L56 50 L42 47 L32.7 45 " +
  "L32.7 58 L31.3 58 L31.3 45 L22 47 L8 50 L12 39 L22 35 L16 30 L7 17 L18 20 L25 27 L27 17 Z";

/** Lobed outlines are generated, not hand-plotted: a width envelope that
 *  pinches to nothing at tip and stem, modulated by a cosine that puts the
 *  lobes in. `lobes`/`amp` are the whole difference between an oak and an
 *  elm — which is the variety the host asked for. */
function lobedLeaf(lobes: number, amp: number, width: number, steps = 48): string {
  const side = (dir: 1 | -1) => {
    const pts: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = 5 + t * 50;
      const env = Math.sin(Math.PI * Math.pow(t, 0.58));
      const wob = 1 + amp * Math.cos(2 * Math.PI * lobes * t);
      pts.push(`${(32 + dir * width * env * wob).toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts;
  };
  return (
    `M${side(1).join(" L")} L${side(-1).reverse().join(" L")} Z ` +
    "M31.3 50 L31.3 58 L32.7 58 L32.7 50 Z"
  );
}

/** Red oak — few, deep, rounded lobes. */
const OAK = lobedLeaf(3.5, 0.4, 17);
/** Elm — long ovate blade with a fine serrated edge. */
const ELM = lobedLeaf(12, 0.1, 16);

const SHAPES = [MAPLE, OAK, ELM] as const;

const VEINS: Record<number, string> = {
  0: "M32 56 L32 8 M32 38 L50 23 M32 38 L50 44 M32 38 L14 23 M32 38 L14 44",
  1: "M32 56 L32 10 M32 22 L42 18 M32 22 L22 18 M32 34 L45 32 M32 34 L19 32 M32 45 L40 44 M32 45 L24 44",
  2: "M32 56 L32 9 M32 18 L40 15 M32 18 L24 15 M32 27 L43 25 M32 27 L21 25 M32 36 L43 35 M32 36 L21 35 M32 45 L39 45 M32 45 L25 45",
};

/** Three greens, then three turned — gold, burnt orange, and a real brown.
 *  Half and half on purpose. */
export const AUGUST_LEAF_COLORS = [
  "#4C7A24",
  "#5E8A2C",
  "#79992C",
  "#C08018",
  "#CB6415",
  "#93380F",
] as const;

/** Index in AUGUST_LEAF_COLORS where the greens stop and the turned begin. */
const TURNED_FROM = 3;

/** A single leaf. Solid body, defined edge, pale veins — it has to hold its
 *  own against a bright page, so it gets weight rather than a glow. */
function Leaf({ size, color, shape }: { size: number; color: string; shape: number }) {
  const d = SHAPES[shape % SHAPES.length];
  const veins = VEINS[shape % SHAPES.length];
  const id = `aug-lf-${shape}-${Math.round(size)}-${color.replace("#", "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ overflow: "visible" }} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={1} />
          <stop offset="100%" stopColor={color} stopOpacity={0.78} />
        </linearGradient>
      </defs>
      <path d={d} fill={`url(#${id})`} stroke="#2A3418" strokeWidth={0.9} strokeOpacity={0.32} />
      <path d={veins} stroke="#F4EFD8" strokeWidth={1.1} opacity={0.5} fill="none" />
    </svg>
  );
}

// ─── Falling ─────────────────────────────────────────────────────────────

/** Seeded LCG so a given seed always lays the leaves out the same way —
 *  screenshots stay stable and SSR matches the client. */
function rng(seed: number) {
  let h = (seed * 2654435761) >>> 0;
  return () => {
    h = (h * 1664525 + 1013904223) >>> 0;
    return h / 0xffffffff;
  };
}

/** Alternate green / turned by index so a still frame always shows both.
 *  Uniform sampling over a dozen leaves regularly produced an all-green
 *  screen, which throws away the brown/orange/yellow the host asked for. */
function mixedColor(i: number, r: () => number): string {
  const pool =
    i % 2 === 0
      ? AUGUST_LEAF_COLORS.slice(0, TURNED_FROM)
      : AUGUST_LEAF_COLORS.slice(TURNED_FROM);
  return pool[Math.floor(r() * pool.length)];
}

function FallingLeaves({
  intensity,
  seed,
  scale,
}: {
  intensity: number;
  seed: number;
  scale: number;
}) {
  const leaves = useMemo(() => {
    const r = rng(seed);
    const n = Math.max(3, Math.round(14 * intensity));
    return Array.from({ length: n }, (_, i) => {
      const fall = 12 + r() * 13;
      return {
        i,
        left: r() * 104 - 2,
        size: (32 + r() * 40) * scale,
        color: mixedColor(i, r),
        shape: Math.floor(r() * 3),
        opacity: 0.8 + r() * 0.2,
        fall,
        // Negative delay so every leaf is already mid-fall on first paint —
        // walking up to a TV should look like a moment inside the weather,
        // not the start of it.
        delay: -r() * fall,
        sway: (26 + r() * 70) * 0.5,
        swayDur: 2.4 + r() * 3.2,
        tumbleDur: 3 + r() * 5,
        tumbleDir: r() > 0.5 ? 1 : -1,
        tilt: r() * 360,
      };
    });
  }, [intensity, scale, seed]);

  return (
    <div
      data-testid="august-leaves"
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      {leaves.map((l) => (
        // The falling wrapper is the FULL height of the surface, so the
        // percentage travel in tr1via-leaf-fall is measured against the
        // screen and not against the leaf inside it.
        <div
          key={l.i}
          style={{
            position: "absolute",
            left: `${l.left}%`,
            top: `-${l.size + 8}px`,
            height: "100%",
            width: 0,
            animation: `tr1via-leaf-fall ${l.fall}s linear ${l.delay}s infinite`,
            opacity: l.opacity,
          }}
        >
          <div
            style={
              {
                animation: `tr1via-leaf-sway ${l.swayDur}s ease-in-out ${l.delay}s infinite alternate`,
                ["--sway" as string]: `${l.sway}px`,
              } as CSSProperties
            }
          >
            <div
              style={
                {
                  animation: `tr1via-leaf-tumble ${l.tumbleDur}s linear ${l.delay}s infinite`,
                  transform: `rotate(${l.tilt}deg)`,
                  ["--dir" as string]: l.tumbleDir,
                } as CSSProperties
              }
            >
              <Leaf shape={l.shape} size={l.size} color={l.color} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── The fire ────────────────────────────────────────────────────────────
// The host's note after the first live night: it needed the campfire the
// month is actually about. The answer is not to repaint the page orange —
// that would spend fall's palette and dull a venue TV. It is to put the page
// NEXT TO a fire: the light comes from low and warm and breathes, the edges
// have started to singe, and embers climb while the leaves come down.
//
// Leaves fall, embers rise. That opposition is the whole tell, and it costs
// nine small dots.

function Embers({ intensity, seed, compact }: { intensity: number; seed: number; compact: boolean }) {
  const embers = useMemo(() => {
    const r = rng(seed * 31 + 7);
    const n = Math.max(4, Math.round((compact ? 6 : 13) * intensity));
    return Array.from({ length: n }, (_, i) => {
      const rise = 7 + r() * 7;
      return {
        i,
        // Clustered toward the corners, the way sparks leave a fire that is
        // off to one side rather than dead centre.
        left: i % 2 === 0 ? 4 + r() * 34 : 62 + r() * 34,
        // Sized to be seen from ten feet on a venue TV. A 2px dot reads as
        // dust on a paper texture; the host's whole first note about this
        // month was that ambient detail was disappearing into the page.
        size: (compact ? 2.4 : 4) + r() * (compact ? 2.2 : 4.5),
        rise,
        delay: -r() * rise,
        drift: (r() * 2 - 1) * (compact ? 26 : 54),
        warm: r() > 0.45,
      };
    });
  }, [compact, intensity, seed]);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {embers.map((e) => (
        <div
          key={e.i}
          style={
            {
              position: "absolute",
              left: `${e.left}%`,
              bottom: -6,
              height: "100%",
              width: 0,
              animation: `tr1via-ember-rise ${e.rise}s linear ${e.delay}s infinite`,
              ["--drift" as string]: `${e.drift}px`,
            } as CSSProperties
          }
        >
          <div
            style={{
              // Pinned to the bottom of the full-height wrapper. The wrapper
              // is what animates, so its -104% travel measures against the
              // screen; a spark left as a plain child would sit at the TOP of
              // that wrapper and leave the frame before it was ever seen.
              position: "absolute",
              bottom: 0,
              width: e.size,
              height: e.size,
              borderRadius: "50%",
              background: e.warm ? "#FFC85A" : "#FF7A22",
              boxShadow: `0 0 ${e.size * 4}px ${e.size * 1.6}px ${
                e.warm ? "rgba(255,176,58,.75)" : "rgba(246,102,22,.62)"
              }, 0 0 ${e.size * 9}px ${e.size * 2.4}px rgba(255,140,40,.28)`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

// ─── The page ────────────────────────────────────────────────────────────

const layer = (style: CSSProperties): CSSProperties => ({
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  ...style,
});

/** Where the page's furniture sits, in pixels, measured against the shells'
 *  own padding: the TV stage pads its content to 56px and a phone screen to
 *  22px, so the holes and the margin rule both have to land left of that. A
 *  margin you write *through* isn't a margin. */
const GUTTER = {
  full: { hole: 18, holeSize: 24, rule: 48, ruleGap: 44 },
  compact: { hole: 3, holeSize: 9, rule: 17, ruleGap: 28 },
} as const;

/** Notebook ruling — blue lines and the red margin rule down the left. */
function Ruling({ compact }: { compact: boolean }) {
  const g = compact ? GUTTER.compact : GUTTER.full;
  return (
    <>
      <div
        style={layer({
          backgroundImage:
            "repeating-linear-gradient(to bottom, rgba(96,150,215,.3) 0 1px, transparent 1px " +
            `${g.ruleGap}px)`,
          maskImage: "linear-gradient(to bottom, transparent, #000 12%, #000 90%, transparent)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 12%, #000 90%, transparent)",
        })}
      />
      <div
        style={layer({
          left: g.rule,
          right: "auto",
          width: 1,
          background: "rgba(216,84,64,.5)",
        })}
      />
    </>
  );
}

/** A leaf that has already landed on the page and stayed there. Anchored to
 *  the page edges only, so nothing ever sits on content. */
function LandedLeaf({
  color,
  size,
  rot,
  style,
}: {
  color: string;
  size: number;
  rot: number;
  style: CSSProperties;
}) {
  return (
    <div
      style={{
        position: "absolute",
        filter: "drop-shadow(2px 5px 4px rgba(60,54,32,.3))",
        transform: `rotate(${rot}deg)`,
        ...style,
      }}
    >
      <Leaf shape={0} size={size} color={color} />
    </div>
  );
}

/** The page itself, with nothing written on it yet: warm paper, ruling,
 *  punch holes, a torn top edge, foxed corners, and leaves that have already
 *  come to rest along the bottom. */
function PageFurniture({ compact }: { compact: boolean }) {
  const holes = compact ? 3 : 4;
  const s = compact ? 0.42 : 1;
  const g = compact ? GUTTER.compact : GUTTER.full;
  const c = AUGUST_LEAF_COLORS;
  return (
    <>
      {/* A sheet of paper in the last of the daylight — the sun is nearly
          down, so the sheet is warm rather than bright. */}
      <div
        style={layer({
          background:
            "radial-gradient(58% 50% at 84% 4%, rgba(255,222,146,.42), transparent 62%)," +
            "linear-gradient(196deg, rgba(255,240,206,.55) 0%, rgba(226,212,174,.34) 60%, rgba(190,174,136,.42) 100%)",
        })}
      />
      {/* And the fire, just off the bottom edge. It breathes; it never
          flickers. A venue TV holds a question for thirty seconds and nothing
          ambient is allowed to pull an eye off it. */}
      <div
        style={layer({
          background:
            "radial-gradient(66% 42% at 20% 110%, rgba(255,146,40,.34), transparent 68%)," +
            "radial-gradient(44% 30% at 80% 108%, rgba(255,104,22,.2), transparent 72%)",
          animation: "tr1via-firelight 7.5s ease-in-out infinite",
        })}
      />
      <Ruling compact={compact} />
      {/* Paper that has spent an evening near a fire: browned at the border,
          properly scorched along the bottom where it sat closest. The reading
          area is untouched — the whole point of a singe is that it stops at
          the edge. */}
      <div
        style={layer({
          background:
            "radial-gradient(118% 98% at 50% 46%, transparent 46%, rgba(158,104,44,.2) 80%, rgba(104,58,22,.4) 100%)," +
            "linear-gradient(to top, rgba(86,44,16,.2) 0%, rgba(120,68,26,.07) 5%, transparent 12%)",
        })}
      />

      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {Array.from({ length: holes }, (_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: g.hole,
              top: `${(100 / (holes + 1)) * (i + 1)}%`,
              width: g.holeSize,
              height: g.holeSize,
              marginTop: -g.holeSize / 2,
              borderRadius: "50%",
              background: "rgba(58,52,32,.42)",
              boxShadow: "inset 0 2px 3px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.55)",
            }}
          />
        ))}
      </div>

      {/* Torn out of the book. */}
      <svg
        width="100%"
        height="15"
        viewBox="0 0 1280 15"
        preserveAspectRatio="none"
        style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
        aria-hidden="true"
      >
        <path
          d="M0 0 H1280 V6 C1240 12 1210 3 1170 8 C1120 14 1090 4 1040 9 C990 14 960 3 910 8 C860 13 830 3 780 8 C730 14 700 4 650 9 C600 14 570 3 520 8 C470 13 440 3 390 8 C340 14 310 4 260 9 C210 14 180 3 130 8 C80 13 40 4 0 8 Z"
          fill="rgba(255,252,240,.9)"
        />
      </svg>

      {/* Landed, along the bottom edge only. Present on every screen of the
          night — they are the point of the month. */}
      <LandedLeaf color={c[4]} size={46 * s} rot={-118} style={{ left: -12 * s, bottom: -14 * s }} />
      <LandedLeaf color={c[3]} size={36 * s} rot={62} style={{ left: 30 * s, bottom: -22 * s }} />
      <LandedLeaf color={c[5]} size={42 * s} rot={148} style={{ right: 2 * s, bottom: -18 * s }} />
      <LandedLeaf color={c[2]} size={32 * s} rot={-46} style={{ right: 46 * s, bottom: -24 * s }} />
    </>
  );
}

// ─── The hand ────────────────────────────────────────────────────────────
// Everything below is drawn in one pen. Keeping the whole vocabulary in a
// single ink is what holds the football cue at the weight the host asked
// for: a doodle in the margin, not a logo on the screen.

/** Ballpoint blue — the same pen the ruling is printed to receive. */
const PEN = "#27498C";

/** A play doodled in the margin. Three linemen, a back, one route, one
 *  arrowhead — what a kid draws in a notebook in August when preseason
 *  starts. Football at its lightest: no team, no ball, no branding. */
function PlayDoodle({ scale = 1 }: { scale?: number }) {
  return (
    <svg
      width={250 * scale}
      height={110 * scale}
      viewBox="0 0 250 110"
      style={{ overflow: "visible" }}
      aria-hidden="true"
    >
      <g stroke={PEN} fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.5}>
        <path d="M6 62 C70 59 150 64 244 60" strokeDasharray="9 7" opacity={0.8} />
        <path d="M28 74 l14 14 M42 74 l-14 14" />
        <path d="M66 75 l14 14 M80 75 l-14 14" />
        <path d="M104 74 l14 14 M118 74 l-14 14" />
        <circle cx={150} cy={86} r={8.5} />
        <path d="M150 77 C150 52 176 46 178 22" strokeDasharray="7 6" />
        <path d="M178 20 l-7 10 M178 20 l8 8" />
        <path d="M74 73 C74 52 52 48 52 30" />
        <path d="M52 28 l-7 10 M52 28 l8 8" />
      </g>
    </svg>
  );
}

/** A football doodled in one pass — the shape and three laces, nothing else. */
function FootballDoodle({ scale = 1 }: { scale?: number }) {
  return (
    <svg width={54 * scale} height={34 * scale} viewBox="0 0 54 34" style={{ overflow: "visible" }} aria-hidden="true">
      <g stroke={PEN} strokeWidth={2.3} strokeLinecap="round" fill="none" opacity={0.5}>
        <path d="M4 17 C12 3 42 3 50 17 C42 31 12 31 4 17 Z" />
        <path d="M19 17 H35" />
        <path d="M23 12.5 V21.5 M27 12 V22 M31 12.5 V21.5" strokeWidth={1.8} />
      </g>
    </svg>
  );
}

/** A star scrawled next to the name that's winning. */
function StarDoodle({ scale = 1 }: { scale?: number }) {
  return (
    <svg width={34 * scale} height={34 * scale} viewBox="0 0 34 34" style={{ overflow: "visible" }} aria-hidden="true">
      <path
        d="M17 2 L21 13 L33 13.5 L23.5 20.5 L27 32 L17 25 L7 32 L10.5 20.5 L1 13.5 L13 13 Z"
        stroke={PEN}
        strokeWidth={2.2}
        strokeLinejoin="round"
        fill="none"
        opacity={0.5}
      />
    </svg>
  );
}

/** The paper football everyone folded in study hall — a triangle of this
 *  same notebook page, fold creases and all. School and football in one
 *  object, which is exactly what August is. */
function PaperFootball({ size = 110 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * 0.86}
      viewBox="0 0 110 95"
      style={{
        overflow: "visible",
        filter: "drop-shadow(4px 8px 6px rgba(60,54,32,.4))",
        transform: "rotate(-7deg)",
      }}
      aria-hidden="true"
    >
      <path d="M6 84 L60 4 L104 74 Z" fill="#FCF8EA" stroke="rgba(60,54,32,.5)" strokeWidth={1.8} strokeLinejoin="round" />
      <path d="M6 84 L60 4 L52 70 Z" fill="rgba(255,255,255,.5)" />
      <path d="M52 70 L60 4 L104 74 Z" fill="rgba(122,104,58,.13)" />
      <g stroke="rgba(60,54,32,.4)" strokeWidth={1.5} fill="none">
        <path d="M6 84 L74 52" />
        <path d="M60 4 L52 70" />
        <path d="M104 74 L36 60" />
      </g>
      <g stroke="rgba(96,150,215,.34)" strokeWidth={1} fill="none">
        <path d="M30 60 L92 66" />
        <path d="M22 71 L98 77" />
      </g>
      <path d="M40 74 L74 62" stroke="rgba(216,84,64,.3)" strokeWidth={1} fill="none" />
    </svg>
  );
}

/** A leaf taped into the page — the single most August-and-school object
 *  there is: the first one that turned, pressed flat under two strips of
 *  tape. This is what makes the early-fall read land on a summer page. */
function TapedLeaf({ color, size = 108 }: { color: string; size?: number }) {
  const tape = (style: CSSProperties) => (
    <div
      style={{
        position: "absolute",
        width: size * 0.34,
        height: size * 0.17,
        background:
          "linear-gradient(105deg, rgba(255,255,255,.62), rgba(232,228,208,.5) 55%, rgba(255,255,255,.58))",
        boxShadow: "0 1px 2px rgba(60,54,32,.22)",
        ...style,
      }}
    />
  );
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          filter: "drop-shadow(2px 4px 3px rgba(60,54,32,.34))",
          transform: "rotate(-14deg)",
        }}
      >
        <Leaf shape={0} size={size} color={color} />
      </div>
      {tape({ top: size * 0.06, left: size * 0.02, transform: "rotate(-34deg)" })}
      {tape({ bottom: size * 0.08, right: size * 0.04, transform: "rotate(-28deg)" })}
    </div>
  );
}

// ─── Marginalia, page by page ────────────────────────────────────────────

/** How many pressed leaves are taped in by this point in the night. The page
 *  fills up as the night goes, so by the finale it is a record of the
 *  evening rather than a decorated background. */
const PRESSED: Record<AugustPageName, number> = {
  lobby: 1,
  board: 2,
  question: 2,
  reveal: 3,
  leaderboard: 3,
  intermission: 4,
  finale: 5,
};

/** Taped-leaf slots, as percentages of the surface so they hold at any TV
 *  resolution. Every slot verified against a real render of that screen —
 *  each sits in genuinely empty page. */
const TAPED_SLOTS: Record<AugustPageName, { style: CSSProperties; size: number }[]> = {
  lobby: [{ style: { left: "45%", top: "53.3%" }, size: 96 }],
  board: [
    { style: { right: "11.7%", top: "74.4%" }, size: 84 },
    { style: { right: "3%", top: "75.3%" }, size: 72 },
  ],
  question: [{ style: { right: "20%", top: "53.5%" }, size: 74 }],
  reveal: [
    { style: { right: "3.4%", top: "77.2%" }, size: 88 },
    { style: { left: "48.4%", top: "82.2%" }, size: 66 },
  ],
  leaderboard: [
    { style: { left: "11.9%", top: "81.9%" }, size: 68 },
    { style: { left: "33.8%", top: "83.6%" }, size: 58 },
    { style: { left: "59.4%", top: "82.8%" }, size: 62 },
  ],
  intermission: [
    { style: { left: "4.8%", top: "86.1%" }, size: 60 },
    { style: { left: "19.2%", top: "87.5%" }, size: 54 },
    { style: { left: "32.2%", top: "86.4%" }, size: 58 },
  ],
  finale: [
    { style: { left: "53.6%", top: "51.7%" }, size: 64 },
    { style: { left: "55%", top: "67.5%" }, size: 54 },
    { style: { left: "53.9%", top: "82.8%" }, size: 58 },
    { style: { left: "4.5%", top: "86.4%" }, size: 56 },
    { style: { left: "17.8%", top: "87.5%" }, size: 48 },
  ],
};

/** The hand that wrote on this page. Full-size surfaces only — a phone is
 *  held one-handed and its page has no spare room. */
function Marginalia({ page }: { page: AugustPageName }) {
  const c = AUGUST_LEAF_COLORS;
  const taped = TAPED_SLOTS[page].slice(0, PRESSED[page]);
  return (
    <>
      {page === "lobby" && (
        <div style={{ position: "absolute", left: "36.6%", top: "29.7%" }}>
          <FootballDoodle scale={1.5} />
        </div>
      )}
      {/* The board gets no hand. It is the one screen of the night with no
          spare page — the grid, the standings panel and the up-next panel
          between them leave nowhere a doodle could sit without hiding behind
          something. Two pressed leaves and the paper carry it. */}
      {page === "question" && (
        // The band between the prompt and the answer cards is the only empty
        // page on this screen, and it is about 100px tall on a 720p stage.
        // The doodle is sized to sit inside it rather than under the cards.
        <div style={{ position: "absolute", left: "8.75%", top: "53.4%" }}>
          <PlayDoodle scale={0.72} />
        </div>
      )}
      {page === "leaderboard" && (
        <div style={{ position: "absolute", left: "1.25%", top: "26.4%" }}>
          <StarDoodle />
        </div>
      )}
      {page === "intermission" && (
        <div style={{ position: "absolute", left: "48.9%", top: "81.1%" }}>
          <PaperFootball size={112} />
        </div>
      )}
      {page === "finale" && (
        <div style={{ position: "absolute", left: "53.9%", top: "24.7%" }}>
          <StarDoodle scale={1.2} />
        </div>
      )}
      {taped.map((t, i) => (
        <div key={i} style={{ position: "absolute", ...t.style }}>
          <TapedLeaf color={c[3 + (i % 3)]} size={t.size} />
        </div>
      ))}
    </>
  );
}

// ─── The whole layer ─────────────────────────────────────────────────────

export interface AugustPageProps {
  /** 0 = off, 1 = default, >1 = heightened (used for the finale). */
  intensity?: number;
  seed?: number;
  /** Phone-sized surface: smaller leaves, tighter ruling, no marginalia. */
  compact?: boolean;
  /** Which screen this is. Omit for no marginalia — the safe default. */
  page?: AugustPageName;
  /** Paint the page itself. Off for surfaces that deliberately paint their
   *  own background — the reveal drops a curtain of the correct-color, and
   *  the notebook has no business repainting it. Leaves still fall. */
  substrate?: boolean;
}

export function AugustPage({
  intensity = 1,
  seed = 1,
  compact = false,
  page,
  substrate = true,
}: AugustPageProps) {
  const reduced = usePrefersReducedMotion();
  if (!intensity) return null;
  return (
    <div
      data-testid="august-page"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      {substrate && (
        <div data-testid="august-substrate" style={{ position: "absolute", inset: 0 }}>
          <PageFurniture compact={compact} />
        </div>
      )}
      {substrate && !compact && page && (
        <div data-testid="august-marginalia" style={{ position: "absolute", inset: 0 }}>
          <Marginalia page={page} />
        </div>
      )}
      {!reduced && (
        <FallingLeaves intensity={intensity} seed={seed} scale={compact ? 0.58 : 1} />
      )}
      {/* Last, so the sparks read above the leaves the way they would in the
          air between you and the fire. */}
      {!reduced && (
        <div data-testid="august-embers" style={{ position: "absolute", inset: 0 }}>
          <Embers intensity={intensity} seed={seed} compact={compact} />
        </div>
      )}
    </div>
  );
}
