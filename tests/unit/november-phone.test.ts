import fs from "node:fs";
// November · "your turkey" rules on the phone (lib/experience/november/phone.ts).

import { describe, expect, it } from "vitest";
import {
  PHONE_TURKEY_MOODS,
  isNovemberPhone,
  phoneTurkeyMood,
  phoneTurkeyPlan,
  phoneTurkeyStripPx,
  phoneTurkeyUrl,
  phoneWorldUrl,
} from "@/lib/experience/november/phone";
import { TURKEY_ANIMS } from "@/lib/experience/november/harvest";

describe("november phone turkey", () => {
  it("only November dresses the phone", () => {
    expect(isNovemberPhone("november")).toBe(true);
    for (const k of ["october", "september", "house", "december"] as const) expect(isNovemberPhone(k)).toBe(false);
    expect(isNovemberPhone(undefined)).toBe(false);
  });

  it("maps every mood to the right strip and play mode", () => {
    const r = { reduced: false };
    expect(phoneTurkeyPlan("waiting", r)).toMatchObject({ anim: "idle", play: "loop", frames: 30 });
    expect(phoneTurkeyPlan("lit", r)).toMatchObject({ anim: "fan", play: "once", frames: 6 });
    expect(phoneTurkeyPlan("blaze", r)).toMatchObject({ anim: "right", play: "once" });
    expect(phoneTurkeyPlan("smoke", r)).toMatchObject({ anim: "wrong", play: "once" });
    expect(phoneTurkeyPlan("toppled", r)).toMatchObject({ anim: "hide", play: "once" });
  });

  it("walks in on arrival, then idles", () => {
    expect(phoneTurkeyPlan("arrive", { reduced: false })).toMatchObject({ anim: "walk", play: "loop" });
    expect(phoneTurkeyPlan("arrive", { reduced: false, arrived: true })).toMatchObject({ anim: "idle", play: "loop" });
  });

  it("reduced motion shows one settled still frame for every mood", () => {
    for (const m of PHONE_TURKEY_MOODS) {
      const p = phoneTurkeyPlan(m, { reduced: true });
      expect(p.play).toBe("still");
      expect(p.anim).not.toBe("walk");
      expect(p.frame).toBeGreaterThanOrEqual(0);
      expect(p.frame).toBeLessThan(p.frames);
    }
    // Locked: the fan's last frame (= fanned-idle's first), since phones ship no fanned-idle strip.
    expect(phoneTurkeyPlan("lit", { reduced: true })).toMatchObject({ anim: "fan", frame: TURKEY_ANIMS.fan.frames - 1 });
    expect(phoneTurkeyPlan("toppled", { reduced: true })).toMatchObject({ anim: "hide", frame: TURKEY_ANIMS.hide.frames - 1 });
    expect(phoneTurkeyPlan("waiting", { reduced: true })).toMatchObject({ anim: "idle", frame: 0 });
  });

  it("unknown moods fall back to the idle turkey", () => {
    expect(phoneTurkeyPlan("bogus" as never, { reduced: false })).toMatchObject({ anim: "idle", play: "loop" });
  });

  it("never steps faster than the art's 12 fps (no flashing)", () => {
    for (const m of PHONE_TURKEY_MOODS) expect(phoneTurkeyPlan(m, { reduced: false }).fps).toBeLessThanOrEqual(12);
  });

  it("fans on lock-in and never dives into the hay before the reveal", () => {
    expect(phoneTurkeyMood("locked")).toBe("lit");
    for (const s of ["sending", "unconfirmed", "rejected", undefined, null]) expect(phoneTurkeyMood(s)).toBe("waiting");
  });

  it("uses 128 px strips for small turkeys, 256 px strips for big ones and the walk", () => {
    expect(phoneTurkeyStripPx("idle", 60)).toBe(128);
    expect(phoneTurkeyStripPx("idle", 120)).toBe(256);
    expect(phoneTurkeyStripPx("fan", 60)).toBe(128);
    expect(phoneTurkeyStripPx("right", 64)).toBe(128);
    expect(phoneTurkeyStripPx("right", 112)).toBe(256);
    expect(phoneTurkeyStripPx("walk", 60)).toBe(256);
    expect(phoneTurkeyStripPx("wrong", 60)).toBe(256);
    expect(phoneTurkeyUrl("idle", 128)).toBe("/themes/november/turkey/A/idle-128.webp");
    expect(phoneWorldUrl("dusk")).toBe("/themes/november/phone/dusk.webp");
  });
});

import {
  finaleWinner,
  phoneCategoryBar,
  phonePreloadUrls,
  phonePreloadWaves,
  safeFinaleWinner,
  stripKeyframes,
} from "@/lib/experience/november/phone";
import { heroTurkeySize } from "@/components/experience/november/NovemberLobby";

describe("november phone step 3b", () => {
  it("strip keyframes carry the pixel value, never var() (Safari-safe)", () => {
    const k = stripKeyframes(-2760);
    expect(k.name).toBe("tr1via-nov-strip-m2760");
    expect(k.css).toContain("background-position: -2760px 0px");
    expect(k.css).not.toContain("transform");
    expect(k.css).not.toContain("var(");
    expect(stripKeyframes(-552.4).name).toBe("tr1via-nov-strip-m552");
    expect(stripKeyframes(Number.NaN).css).toContain("background-position: 0px 0px; }");
  });

  it("preloads every strip a mood change can need, plus dusk and night, in three sets", () => {
    const urls = phonePreloadUrls();
    for (const a of ["right", "wrong", "hide"]) expect(urls).toContain(`/themes/november/turkey/A/${a}-256.webp`);
    for (const a of ["idle", "fan", "right"]) expect(urls).toContain(`/themes/november/turkey/A/${a}-128.webp`);
    // The lobby's own walk loads with the lobby only.
    expect(urls).not.toContain("/themes/november/turkey/A/walk-256.webp");
    // Late joiners: the half-time turkey (idle 256) and the finale's
    // "Your night" turkey (fan 256) are in a set too.
    expect(phonePreloadWaves().reveal).toContain("/themes/november/turkey/A/idle-256.webp");
    expect(phonePreloadWaves().night).toContain("/themes/november/turkey/A/fan-256.webp");
    expect(phonePreloadWaves().soon).toContain("/themes/november/phone/dusk.webp");
    expect(phonePreloadWaves().night).toContain("/themes/november/phone/night.webp");
    for (const u of urls) expect(fs.existsSync(`public${u}`)).toBe(true);
    expect(urls).toContain("/themes/november/phone/dusk.webp");
    expect(urls).toContain("/themes/november/phone/night.webp");
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("category bar: other months unchanged, November on the dark panel", () => {
    expect(phoneCategoryBar(false, "#3FD0E0")).toEqual({ background: "#3FD0E0", ink: "#0E0805", eyebrow: "rgba(14,8,5,.65)", tagColor: "#0E0805", tagInk: "#3FD0E0" });
    const nov = phoneCategoryBar(true, "#3FD0E0");
    expect(JSON.stringify(nov)).not.toContain("#3FD0E0");
    expect(nov.tagColor).toBe("#C25E22");
  });

  it("finale winner: real names only, ties joined, unknown -> null", () => {
    const r = (id: string, rank: number, score: number, name?: string | null) => ({ rank, row: { player_id: id, score, display_name: name } });
    expect(finaleWinner([r("a", 1, 2940, "Linda"), r("b", 2, 100, "Cole")])).toEqual({ name: "Linda", score: 2940 });
    expect(finaleWinner([r("a", 1, 50, "Linda"), r("b", 1, 50, "Cole")])?.name).toBe("Linda & Cole");
    expect(finaleWinner([r("a", 1, 50, null)], new Map([["a", "Theo"]]))?.name).toBe("Theo");
    expect(finaleWinner([r("a", 1, 50, null)])).toBeNull();
    expect(finaleWinner([])).toBeNull();
  });

  it("hero turkey fits the space between 96 and 236 px", () => {
    expect(heroTurkeySize(346, 400)).toBe(215);
    expect(heroTurkeySize(400, 600)).toBe(236);
    expect(heroTurkeySize(331, 100)).toBe(96);
  });
});

describe("safeFinaleWinner", () => {
  it("passes the winner through and turns a throw into no winner card", () => {
    expect(safeFinaleWinner(() => ({ name: "Maya", score: 3 }))).toEqual({ name: "Maya", score: 3 });
    expect(
      safeFinaleWinner(() => {
        throw new Error("bad row");
      }),
    ).toBeNull();
  });
});
