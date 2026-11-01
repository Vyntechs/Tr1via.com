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

  it("uses the small 128 px idle only for the small turkey, 256 px strips otherwise", () => {
    expect(phoneTurkeyStripPx("idle", 60)).toBe(128);
    expect(phoneTurkeyStripPx("idle", 120)).toBe(256);
    expect(phoneTurkeyStripPx("fan", 60)).toBe(256);
    expect(phoneTurkeyUrl("idle", 128)).toBe("/themes/november/turkey/A/idle-128.webp");
    expect(phoneWorldUrl("dusk")).toBe("/themes/november/phone/dusk.webp");
  });
});
