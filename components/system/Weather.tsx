// Per-month weather. Each themeKey gets a distinct ambient visual:
// drifting snow for January, heart confetti for February, falling clovers
// for March, spring rain for April, distant lightning for May, sun shimmer
// for June, firework bursts for July, drifting leaves for fall months,
// pumpkin glow for October, snow+pine for December.
//
// Discipline: subtle, always under ~8% opacity for ambient particles.
// Pointer-events: none — never competes with foreground interaction.

import { ParticleField } from "./ParticleField";
import { Snowflake, Heart, Clover, Leaf, Pumpkin, Firework, Pine, Rain } from "./motifs";
import { TR1VIA_THEMES, type ThemeKey } from "@/lib/theme/tokens";

export interface WeatherProps {
  themeKey?: ThemeKey;
  /** 0 = off, 1 = default, >1 = heightened (used for the finale). */
  intensity?: number;
  seed?: number;
}

export function Weather({ themeKey = "house", intensity = 1, seed = 1 }: WeatherProps) {
  if (!intensity) return null;
  const t = TR1VIA_THEMES[themeKey];
  if (!t) return null;
  const count = (n: number) => Math.max(2, Math.round(n * intensity));

  switch (themeKey) {
    case "january":
      return (
        <ParticleField
          count={count(24)}
          Glyph={Snowflake}
          sizeRange={[5, 11]}
          durationRange={[14, 26]}
          colors={["#FFFFFF", "#D8E6F4"]}
          opacityRange={[0.18, 0.55]}
          seed={seed}
        />
      );
    case "february":
      return (
        <ParticleField
          count={count(14)}
          Glyph={Heart}
          sizeRange={[8, 14]}
          durationRange={[18, 32]}
          colors={["#FF4673", "#FFD93D", "#FF9DB6"]}
          opacityRange={[0.18, 0.5]}
          seed={seed}
        />
      );
    case "march":
      return (
        <ParticleField
          count={count(14)}
          Glyph={Clover}
          sizeRange={[8, 14]}
          durationRange={[16, 30]}
          colors={["#3FAE56", "#5BCB72"]}
          opacityRange={[0.22, 0.55]}
          seed={seed}
        />
      );
    case "april":
      return (
        <ParticleField
          count={count(40)}
          Glyph={Rain}
          sizeRange={[6, 10]}
          durationRange={[1.5, 3.5]}
          colors={["#7A4FCC", "#A88BD6"]}
          opacityRange={[0.18, 0.4]}
          driftRange={[10, 24]}
          seed={seed}
        />
      );
    case "may":
      return <LightningFlicker color="#E8C46A" />;
    case "june":
      return <SunShimmer color={t.accent} />;
    case "july":
      return <FireworkBursts colors={["#E63946", "#FFD93D", "#FFFFFF"]} />;
    case "august":
    case "september":
    case "november":
      return (
        <ParticleField
          count={count(14)}
          Glyph={Leaf}
          sizeRange={[10, 18]}
          durationRange={[14, 24]}
          colors={["#C25E22", "#F08C2A", "#7E8C2A"]}
          opacityRange={[0.3, 0.7]}
          spinRange={[-360, 360]}
          seed={seed}
        />
      );
    case "october":
      return (
        <>
          <FlickerGlow color="#F08C2A" />
          <ParticleField
            count={count(8)}
            Glyph={Pumpkin}
            sizeRange={[14, 22]}
            durationRange={[20, 32]}
            colors={["#F08C2A", "#A94ACC"]}
            opacityRange={[0.18, 0.4]}
            seed={seed}
          />
        </>
      );
    case "december":
      return (
        <>
          <ParticleField
            count={count(20)}
            Glyph={Snowflake}
            sizeRange={[5, 10]}
            durationRange={[14, 26]}
            colors={["#FFFFFF", "#F4E6C4"]}
            opacityRange={[0.22, 0.5]}
            seed={seed}
          />
          <ParticleField
            count={count(4)}
            Glyph={Pine}
            sizeRange={[16, 24]}
            durationRange={[26, 38]}
            colors={["#1F5A36", "#3A7A4E"]}
            opacityRange={[0.3, 0.55]}
            spinRange={[-20, 20]}
            seed={seed + 100}
          />
        </>
      );
    case "daylight":
    case "house":
    default:
      return <WarmLight />;
  }
}

// ─── Ambient effects (not particle-based) ────────────────────────────────

function LightningFlicker({ color = "#E8C46A" }: { color?: string }) {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(60% 40% at 70% 0%, ${color}, transparent 60%)`,
          mixBlendMode: "screen",
          animation: "tr1via-lightning 11s infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(40% 30% at 20% 10%, ${color}99, transparent 70%)`,
          mixBlendMode: "screen",
          animation: "tr1via-lightning 13.7s infinite 3.4s",
        }}
      />
    </div>
  );
}

function FireworkBursts({ colors = ["#E63946", "#FFD93D"] }: { colors?: string[] }) {
  const bursts = [
    { x: "15%", y: "18%", delay: 0,   color: colors[0],            dur: 6.0 },
    { x: "82%", y: "12%", delay: 1.7, color: colors[1],            dur: 7.4 },
    { x: "88%", y: "78%", delay: 3.1, color: colors[2] ?? colors[0], dur: 8.1 },
    { x: "8%",  y: "64%", delay: 4.6, color: colors[0],            dur: 6.6 },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {bursts.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: b.x,
            top: b.y,
            animation: `tr1via-burst ${b.dur}s ease-out ${b.delay}s infinite`,
            opacity: 0,
          }}
        >
          <Firework size={56} color={b.color} />
        </div>
      ))}
    </div>
  );
}

function FlickerGlow({ color = "#F08C2A" }: { color?: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: `radial-gradient(120% 40% at 50% 100%, ${color}22, transparent 60%)`,
        animation: "tr1via-glow-flicker 4.2s ease-in-out infinite",
        mixBlendMode: "screen",
      }}
    />
  );
}

function WarmLight() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background:
          "radial-gradient(70% 50% at 15% 10%, rgba(255,176,90,.08), transparent 60%), radial-gradient(50% 40% at 90% 90%, rgba(78,205,196,.06), transparent 60%)",
      }}
    />
  );
}

function SunShimmer({ color = "#F2A02D" }: { color?: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: `radial-gradient(60% 40% at 80% 10%, ${color}1A, transparent 60%), radial-gradient(50% 40% at 20% 90%, ${color}10, transparent 60%)`,
      }}
    />
  );
}

/** Human-readable label for each microclimate, used in /_dev/system. */
export function weatherLabel(themeKey: ThemeKey): string {
  return ({
    house: "warm pub-light wash",
    daylight: "sunlit room",
    january: "drifting snow",
    february: "heart confetti",
    march: "falling clovers",
    april: "spring rain",
    may: "distant lightning",
    june: "sun shimmer",
    july: "firework bursts",
    august: "drifting leaves",
    september: "drifting leaves",
    october: "pumpkin glow",
    november: "autumn drift",
    december: "snow + pine",
  } as Record<ThemeKey, string>)[themeKey] ?? "ambient";
}
