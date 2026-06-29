"use client";

import type { ThemeKey } from "@/lib/theme/tokens";

export type MonthlyThemeKey = Exclude<ThemeKey, "house" | "daylight">;

type TroupeMember = {
  name: string;
  role: string;
  gesture: string;
  prop: string;
  shape: string;
};

export const THEME_TROUPE: Record<MonthlyThemeKey, TroupeMember> = {
  january: { name: "Glint", role: "ice cue keeper", gesture: "glass-step", prop: "frost card", shape: "crystal" },
  february: { name: "Luma", role: "heartlight keeper", gesture: "soft-sway", prop: "ribbon glow", shape: "heart" },
  march: { name: "Pip", role: "clover stagehand", gesture: "quick-hop", prop: "gold fleck", shape: "clover" },
  april: { name: "Vera", role: "bloom switcher", gesture: "petal-turn", prop: "rain charm", shape: "petal" },
  may: { name: "Rook", role: "storm cue keeper", gesture: "flash-freeze", prop: "cloud card", shape: "bolt" },
  june: { name: "Sol", role: "summer light puller", gesture: "sun-drift", prop: "warm lens", shape: "sun" },
  july: { name: "Nova", role: "sparkler cue", gesture: "bright-pop", prop: "paper spark", shape: "spark" },
  august: { name: "Ember", role: "late-sun stagehand", gesture: "slow-slide", prop: "amber flag", shape: "flag" },
  september: { name: "Marn", role: "fall turner", gesture: "leaf-pivot", prop: "copper card", shape: "leaf" },
  october: { name: "Hex", role: "shadow cue keeper", gesture: "peek-hide", prop: "tiny lantern", shape: "lantern" },
  november: { name: "Gourd", role: "table-glow keeper", gesture: "warm-bow", prop: "harvest tile", shape: "tile" },
  december: { name: "Gleam", role: "pine light puller", gesture: "soft-halo pose", prop: "star tag", shape: "star" },
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

  const member = THEME_TROUPE[themeKey];
  const isHome = activeIndex === homeIndex;

  return (
    <div
      aria-hidden="true"
      data-testid="theme-character-band"
      data-theme-character={themeKey}
      className="pointer-events-none mx-auto mt-6 grid max-w-[1140px] grid-cols-[1fr_auto_1fr] items-end gap-3 px-6 sm:mt-8"
    >
      <div className="hidden h-px bg-[color:var(--line)] sm:block" />
      <div
        className="relative isolate flex min-h-[124px] max-w-full items-end justify-center gap-4 overflow-hidden rounded-2xl px-5 py-4 motion-safe:animate-[tr1via-rise_520ms_ease-out_both] sm:min-h-[136px] sm:px-7"
        style={{
          background: "color-mix(in srgb, var(--surface) 68%, transparent)",
          border: "1px solid var(--line)",
          boxShadow: "0 24px 70px -50px var(--accent)",
          color: "var(--ink)",
        }}
      >
        <span
          className="absolute inset-x-8 bottom-9 -z-10 h-12 rounded-full opacity-50 blur-xl"
          style={{ background: "var(--accent)" }}
        />
        <span
          className="absolute bottom-4 left-5 h-px w-16 -rotate-6 opacity-70 sm:left-8 sm:w-24"
          style={{ background: "var(--line)" }}
        />
        <span
          className="absolute bottom-4 right-5 h-px w-16 rotate-6 opacity-70 sm:right-8 sm:w-24"
          style={{ background: "var(--line)" }}
        />
        <span
          className="grid h-20 w-12 place-items-center rounded-xl border text-[8px] font-bold uppercase tracking-[0.12em] sm:h-24 sm:w-16"
          style={{
            borderColor: "var(--line)",
            background: "var(--surface)",
            color: "var(--ink-mid)",
            boxShadow: "0 16px 34px -26px var(--accent)",
          }}
        >
          TV
        </span>
        <span
          className="relative grid size-20 place-items-center rounded-full border text-[12px] font-extrabold uppercase tracking-[0.12em] motion-safe:animate-[tr1via-float_2.6s_ease-in-out_infinite] sm:size-24 sm:text-[13px]"
          style={{
            borderColor: "var(--line)",
            background: "var(--surface)",
            boxShadow: "0 16px 36px -24px var(--accent)",
            color: "var(--ink)",
          }}
        >
          <span
            className="absolute -right-1 -top-1 grid size-7 place-items-center rounded-full text-[8px] sm:size-8"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {member.shape.slice(0, 1).toUpperCase()}
          </span>
          <span
            className="absolute bottom-2 h-6 w-9 rounded-b-full rounded-t-sm"
            style={{ background: "var(--accent)", opacity: 0.26 }}
          />
          {member.name}
        </span>
        <span
          className="grid h-16 w-10 place-items-center rounded-xl border text-[8px] font-bold uppercase tracking-[0.12em] sm:h-20 sm:w-12"
          style={{
            borderColor: "var(--line)",
            background: "var(--surface)",
            color: "var(--ink-mid)",
            boxShadow: "0 16px 34px -26px var(--accent)",
          }}
        >
          Host
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="max-w-[46vw] truncate rounded-full bg-accent px-3 py-1 font-[family-name:var(--font-mono)] text-[10px] font-bold uppercase tracking-[0.14em] text-white sm:max-w-none">
            {member.role}
          </span>
          <span
            className="max-w-[46vw] truncate rounded-full px-3 py-1 text-[10px] font-semibold sm:max-w-none"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              color: "var(--ink-mid)",
            }}
          >
            {isHome ? "you are here" : `${member.gesture} - ${member.prop}`}
          </span>
        </span>
      </div>
      <div className="hidden h-px bg-[color:var(--line)] sm:block" />
    </div>
  );
}
