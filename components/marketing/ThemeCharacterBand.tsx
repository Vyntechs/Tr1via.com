"use client";

import type { ThemeKey } from "@/lib/theme/tokens";

export type MonthlyThemeKey = Exclude<ThemeKey, "house" | "daylight">;

type RoomMagicPreview = {
  effect: string;
  reaction: string;
  cue: string;
};

export const ROOM_MAGIC_PREVIEWS: Record<MonthlyThemeKey, RoomMagicPreview> = {
  january: { effect: "Ice shimmer", reaction: "nice", cue: "frosted room glow" },
  february: { effect: "Heartlight pulse", reaction: "aww", cue: "soft pink burst" },
  march: { effect: "Clover flash", reaction: "lucky", cue: "green pop" },
  april: { effect: "Bloom ripple", reaction: "wow", cue: "petal sweep" },
  may: { effect: "Storm flash", reaction: "wow", cue: "lightning room pulse" },
  june: { effect: "Summer flare", reaction: "yes", cue: "gold wash" },
  july: { effect: "Firework pop", reaction: "boom", cue: "sky burst" },
  august: { effect: "Late-sun glow", reaction: "nice", cue: "amber lift" },
  september: { effect: "Leaf sweep", reaction: "wow", cue: "copper drift" },
  october: { effect: "Lantern blink", reaction: "spooky", cue: "shadow flicker" },
  november: { effect: "Table glow", reaction: "yes", cue: "harvest warmth" },
  december: { effect: "Pine sparkle", reaction: "cheer", cue: "winter twinkle" },
};

function isMonthlyThemeKey(themeKey: ThemeKey): themeKey is MonthlyThemeKey {
  return themeKey !== "house" && themeKey !== "daylight";
}

export function ThemeCharacterBand({
  themeKey,
  activeIndex,
  homeIndex,
}: {
  themeKey: ThemeKey;
  activeIndex: number;
  homeIndex: number;
}) {
  if (!isMonthlyThemeKey(themeKey)) return null;

  const preview = ROOM_MAGIC_PREVIEWS[themeKey];
  const isHome = activeIndex === homeIndex;

  return (
    <div
      aria-hidden="true"
      data-testid="theme-character-band"
      data-theme-character={themeKey}
      className="pointer-events-none mx-auto mt-6 grid max-w-[1140px] grid-cols-1 items-end gap-3 px-6 sm:mt-8 sm:grid-cols-[1fr_auto_1fr]"
    >
      <div className="hidden h-px bg-[color:var(--line)] sm:block" />
      <div
        className="relative isolate grid w-full max-w-[720px] gap-4 overflow-hidden rounded-2xl px-5 py-5 motion-safe:animate-[tr1via-rise_520ms_ease-out_both] sm:grid-cols-[0.86fr_1.14fr] sm:px-6"
        style={{
          background: "color-mix(in srgb, var(--surface) 68%, transparent)",
          border: "1px solid var(--line)",
          boxShadow: "0 24px 70px -50px var(--accent)",
          color: "var(--ink)",
        }}
      >
        <span
          className="absolute inset-x-8 bottom-8 -z-10 h-16 rounded-full opacity-45 blur-xl"
          style={{ background: "var(--accent)" }}
        />
        <span
          className="absolute bottom-4 left-5 h-px w-24 -rotate-3 opacity-70 sm:left-8 sm:w-32"
          style={{ background: "var(--line)" }}
        />

        <span className="grid gap-2 text-left">
          <span className="font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: "var(--accent)" }}>
            Room Magic
          </span>
          <span className="text-[22px] font-black leading-[1.02] tracking-normal sm:text-[28px]" style={{ color: "var(--ink)" }}>
            Players tap reactions. The room answers back.
          </span>
          <span
            className="text-[12px] font-semibold leading-snug"
            style={{ color: "var(--ink-mid)" }}
          >
            {isHome
              ? "This is the live month preview."
              : `This month previews ${preview.cue}.`}
          </span>
        </span>

        <span
          className="grid w-full gap-3 rounded-2xl p-3"
          style={{
            background: "rgba(7,8,18,0.72)",
            border: "1px solid color-mix(in srgb, var(--line) 72%, transparent)",
          }}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.16em]" style={{ color: "var(--correct)" }}>
              Venue screen
            </span>
            <span
              className="rounded-full px-2.5 py-1 font-[family-name:var(--font-mono)] text-[8px] font-bold uppercase tracking-[0.12em]"
              style={{ background: "rgba(255,255,255,0.1)", color: "var(--ink)" }}
            >
              Live room
            </span>
          </span>
          <span className="text-[18px] font-black leading-tight text-white sm:text-[20px]">
            {preview.effect} hits the screen.
          </span>
          <span className="flex flex-wrap gap-2">
            {["yes", preview.reaction, "no way"].map((reaction, index) => {
              const active = index === 1;
              return (
                <span
                  key={`${reaction}-${index}`}
                  className="rounded-full px-3 py-1.5 font-[family-name:var(--font-mono)] text-[9px] font-bold uppercase tracking-[0.12em] text-white"
                  style={{
                    background: active ? "var(--accent)" : "rgba(255,255,255,0.11)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  {reaction}
                </span>
              );
            })}
          </span>
          <span className="grid grid-cols-3 gap-2">
            {["player taps", "host sees", "screen blooms"].map((label) => (
              <span
                key={label}
                className="rounded-xl px-2 py-2 text-center text-[9px] font-semibold leading-tight"
                style={{
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(255,255,255,0.84)",
                }}
              >
                {label}
              </span>
            ))}
          </span>
          <span
            className="rounded-full px-3 py-1 text-[10px] font-semibold"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              color: "var(--ink-mid)",
            }}
          >
            {preview.cue}
          </span>
        </span>
      </div>
      <div className="hidden h-px bg-[color:var(--line)] sm:block" />
    </div>
  );
}
