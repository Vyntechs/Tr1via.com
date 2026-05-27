// WelcomeOverlay — the Magic-Welcome cinematic tile.
//
// One slide-in name tile, anchored bottom-right of its container,
// triggered when a new player joins a night. Used on both the venue TV
// and the host live console (which HDMI's to the TV). Optional sparkle
// trail for the first few joiners of the night ("Pixar hero entrance"
// energy that drops back to a calm slide once the lobby fills).
//
// Architecture mirrors TVSectionComplete.tsx: scoped <style> block with
// keyframes, parent owns the mount/unmount lifecycle, this component
// just handles the visual treatment. The 360ms entrance + 2500ms hold +
// 200ms exit timeline is implemented entirely in CSS so the parent can
// fire-and-forget — set `welcomeEvent`, wait the duration, unset.
//
// Reduced-motion: the slide and scale collapse to an instant opacity
// fade. The chime (separate module) is brief and informational, not
// motion, so it still plays.

"use client";

interface WelcomeOverlayProps {
  /** Display name of the joining player. */
  name: string;
  /** Per-player hex color (from lib/player/playerColor.ts). */
  color: string;
  /** True for the first 3-5 joiners of the night — adds the sparkle trail. */
  isHeroEntrance?: boolean;
  /** When true, swap the slide/scale animation for an instant fade. */
  prefersReducedMotion?: boolean;
  /**
   * Stable token that changes every time a NEW welcome should fire — pass
   * `playerId` or a `joinIndex`. The component remounts on key changes
   * automatically via the parent's React key prop; this prop is exposed
   * so the parent has the option to vary other behaviours per-join.
   */
  joinToken?: string | number;
  /** Optional accent token for the leading-edge glow stinger. Falls back
   *  to the player's color when not provided. */
  glowColor?: string;
}

/**
 * Renders the slide-in welcome tile. The parent is responsible for
 * mounting (when a new player joins) and unmounting (after ~3 seconds
 * total). The animation duration is encoded in the CSS keyframes — the
 * parent can use `WELCOME_OVERLAY_DURATION_MS` as the unmount timer.
 */
export function WelcomeOverlay({
  name,
  color,
  isHeroEntrance = false,
  prefersReducedMotion = false,
  joinToken: _joinToken,
  glowColor,
}: WelcomeOverlayProps) {
  const accent = glowColor ?? color;
  const motionClass = prefersReducedMotion ? "wo-motion-reduced" : "wo-motion-full";
  return (
    <div
      data-testid="welcome-overlay"
      className={`wo-root ${motionClass}`}
      aria-live="polite"
      role="status"
      style={{
        position: "absolute",
        right: 56,
        bottom: 96,
        zIndex: 40,
        pointerEvents: "none",
      }}
    >
      {/* Sparkle trail — only the first few joins of the night. Pure CSS
          dots, no canvas, no library. Sits BEHIND the tile so it reads
          as motion echo, not foreground glitter. */}
      {isHeroEntrance && !prefersReducedMotion && (
        <div aria-hidden="true" className="wo-sparkles">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={`wo-spark wo-spark-${i}`}
              style={{ background: accent }}
            />
          ))}
        </div>
      )}

      <div
        className="wo-tile"
        style={{
          // The tile fills with a translucent wash of the player's color so
          // the welcome reads as "your color" at a glance.
          background: hexToRgba(color, 0.18),
          border: `1px solid ${hexToRgba(color, 0.55)}`,
          color: "#FFF",
          borderRadius: 14,
          padding: "14px 22px 14px 18px",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          gap: 14,
          minWidth: 280,
          boxShadow: `0 18px 40px ${hexToRgba("#000000", 0.45)}, 0 0 0 1px ${hexToRgba(accent, 0.18)} inset`,
        }}
      >
        <span
          aria-hidden="true"
          className="wo-dot"
          style={{
            width: 10,
            height: 10,
            borderRadius: 99,
            background: color,
            boxShadow: `0 0 14px ${hexToRgba(color, 0.7)}`,
            flex: "0 0 auto",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.62)",
          }}
        >
          Just joined
        </span>
        <span
          style={{
            fontFamily: "var(--font-sans)",
            fontWeight: 700,
            fontSize: 22,
            letterSpacing: "-0.015em",
            color: "#FFF",
            // The name carries the player's hex as a soft accent on the
            // first letter via a ::first-letter rule below — keeps the
            // headline readable while still signaling identity.
          }}
        >
          {name}
        </span>
      </div>

      <style>{`
        /* ── Full-motion entrance, the default. ── */
        @keyframes wo-tile-in {
          0%   { opacity: 0; transform: translate3d(28px, 16px, 0) scale(0.96); }
          50%  { opacity: 1; transform: translate3d(0, 0, 0) scale(1.02); }
          70%  { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
          92%  { opacity: 1; transform: translate3d(0, 0, 0) scale(1); }
          100% { opacity: 0; transform: translate3d(0, -6px, 0) scale(1); }
        }
        @keyframes wo-tile-glow {
          0%, 100% { box-shadow: 0 18px 40px rgba(0,0,0,0.45), 0 0 0 1px ${hexToRgba(accent, 0.18)} inset; }
          26%      { box-shadow: 0 18px 40px rgba(0,0,0,0.45), 0 0 28px ${hexToRgba(accent, 0.55)}, 0 0 0 1px ${hexToRgba(accent, 0.6)} inset; }
        }
        .wo-motion-full .wo-tile {
          animation:
            wo-tile-in 3060ms cubic-bezier(0.05, 0.7, 0.1, 1) forwards,
            wo-tile-glow 720ms cubic-bezier(0.4, 0, 0.2, 1) 80ms 1;
          /* The two keyframe animations run independently — "forwards" on
             tile-in pins the final opacity:0 state, glow finishes early
             and stays at its baseline shadow. */
          will-change: transform, opacity;
        }
        /* ── Reduced motion: just a hold + fade. ── */
        @keyframes wo-tile-fade-only {
          0%, 100% { opacity: 0; }
          10%, 90% { opacity: 1; }
        }
        .wo-motion-reduced .wo-tile {
          animation: wo-tile-fade-only 3060ms linear forwards;
        }

        /* ── Sparkle trail — only the first few joiners. ── */
        .wo-sparkles {
          position: absolute;
          right: 36px;
          bottom: 30px;
          width: 60px;
          height: 60px;
          pointer-events: none;
        }
        .wo-spark {
          position: absolute;
          width: 5px;
          height: 5px;
          border-radius: 99px;
          opacity: 0;
          animation: wo-spark-fly 720ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
        }
        @keyframes wo-spark-fly {
          0%   { opacity: 0; transform: translate3d(0, 0, 0) scale(0.4); }
          30%  { opacity: 1; }
          100% { opacity: 0; transform: var(--spark-end-transform); }
        }
        .wo-spark-0 { animation-delay: 100ms; --spark-end-transform: translate3d(28px, 8px, 0) scale(1); }
        .wo-spark-1 { animation-delay: 140ms; --spark-end-transform: translate3d(32px, -6px, 0) scale(1.1); }
        .wo-spark-2 { animation-delay: 180ms; --spark-end-transform: translate3d(22px, -18px, 0) scale(0.9); }
        .wo-spark-3 { animation-delay: 220ms; --spark-end-transform: translate3d(40px, 4px, 0) scale(1); }
        .wo-spark-4 { animation-delay: 260ms; --spark-end-transform: translate3d(46px, -10px, 0) scale(1.2); }
        .wo-spark-5 { animation-delay: 300ms; --spark-end-transform: translate3d(18px, 14px, 0) scale(0.8); }

        @media (prefers-reduced-motion: reduce) {
          /* Belt-and-braces: even if the parent didn't pass
             prefersReducedMotion, honor the media query at the CSS layer.
             Removes the slide; keeps the fade. */
          .wo-motion-full .wo-tile {
            animation: wo-tile-fade-only 3060ms linear forwards;
          }
          .wo-sparkles { display: none; }
        }
      `}</style>
    </div>
  );
}

/** Match the encoded animation duration (entrance + hold + exit). Parents
 *  should unmount the overlay after this many ms. */
export const WELCOME_OVERLAY_DURATION_MS = 3060;

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace(/^#/, "");
  if (cleaned.length !== 6) return hex;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
