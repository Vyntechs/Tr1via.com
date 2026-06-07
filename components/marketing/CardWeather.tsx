// The live ambient-weather layer for a theme-showcase card.
//
// This is a deliberate CLIENT island: <Weather> renders <ParticleField> and
// passes a Glyph *function* as a prop, which can't cross a server→client
// boundary. Keeping that inside a "use client" component means the showcase
// card (and its pages) stay server-rendered for SEO — only this drifting layer
// hydrates. Props are serializable (themeKey + seed), so the boundary is clean.
//
// Fidelity: the 10 particle months use the SAME <Weather> the product runs. May
// (canvas lightning + procedural thunder AUDIO) and June (canvas sky) are
// "TV-only by construction" and would be wrong on a marketing page, so they get
// a silent particle stand-in (drifting bolts / suns).

"use client";

import { Weather, ParticleField } from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

function Bolt({ size = 12, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: "block" }}>
      <path d="M7 1 L2.5 7 H5.4 L4.5 11 L9.5 5 H6.6 Z" fill={color} />
    </svg>
  );
}
function Sun({ size = 12, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: "block" }}>
      <circle cx="6" cy="6" r="2.6" fill={color} />
      <g stroke={color} strokeWidth="1" strokeLinecap="round">
        <line x1="6" y1="0.5" x2="6" y2="1.8" /><line x1="6" y1="10.2" x2="6" y2="11.5" />
        <line x1="0.5" y1="6" x2="1.8" y2="6" /><line x1="10.2" y1="6" x2="11.5" y2="6" />
      </g>
    </svg>
  );
}

export function CardWeather({ themeKey, seed }: { themeKey: ThemeKey; seed: number }) {
  if (themeKey === "may") {
    return (
      <ParticleField
        count={7} Glyph={Bolt} colors={["#E8C46A", "#94A5BC"]}
        sizeRange={[10, 18]} durationRange={[16, 28]} opacityRange={[0.22, 0.5]} seed={seed}
      />
    );
  }
  if (themeKey === "june") {
    return (
      <ParticleField
        count={6} Glyph={Sun} colors={["#F2A02D", "#E04A6B"]}
        sizeRange={[12, 20]} durationRange={[20, 34]} opacityRange={[0.2, 0.42]} seed={seed}
      />
    );
  }
  return <Weather themeKey={themeKey} intensity={0.5} seed={seed} />;
}
