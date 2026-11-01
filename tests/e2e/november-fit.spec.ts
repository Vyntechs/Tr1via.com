// November TV: the winner, reveal and stumper screens fit their 1600×680 part
// of the stage with worst-case content, and nothing sits under the turkeys.
//
// The winner screen keeps its everyday layout squeezed into 680 px; the reveal
// and stumper lose height to November's panel padding. Each case loads the
// database-free /dev/tv/world preview with wide=1 (every team name ~24
// characters, the top score 12,840, long category names) and checks every
// visible text run and card:
//   - not cut by any ancestor that hides its overflow (all four edges),
//   - not overflowing its own box (team names may end in "…" by design, the
//     same as every other month; the winner's name and the answer never),
//   - above the turkey row (stage y 676) and inside the 1600-wide stage.
// Measured in stage pixels (the 1600×900 stage renders 1:1 at 1600×900).

import { test, expect } from "@playwright/test";

const ROW_TOP = 676;
// The wide=1 team names (app/dev/tv/world/page.tsx), the only text allowed an ellipsis.
const TEAM_NAMES = /^(The Quizzly|Les Quizerables|Smarty Pints|Agatha Quiztie|Trivia Newton|Universally|Quiz Khalifa|Hot Sauce Comm)/;

const CASES = [
  { name: "winner, one champion", q: "moment=winner&players=41", root: "tv-finale-winner" },
  { name: "winner, a tie (two long names)", q: "moment=winner&players=41&long=1", root: "tv-finale-winner" },
  { name: "winner, one player (no podium)", q: "moment=winner&players=1", root: "tv-finale-winner" },
  { name: "reveal, long question + answer + fact", q: "moment=reveal&players=41&long=1", root: "tv-reveal", text: "CORRECT ANSWER" },
  { name: "stumper, four who nailed it", q: "moment=reveal&players=41&long=1&locked=5", root: "tv-reveal", text: "TOUGH ONE" },
] as const;

for (const c of CASES) {
  test(`November fit at 1600×900: ${c.name}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/dev/tv/world?${c.q}&wide=1&theme=november&tier=still`);
    const root = page.getByTestId(c.root);
    await expect(root).toBeVisible({ timeout: 30_000 });
    if ("text" in c) await expect(root).toContainText(c.text);
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await page.waitForTimeout(1000); // auto-fit settles

    const report = await page.evaluate(([rowTop, namePattern]) => {
      const TEAM_NAME = new RegExp(namePattern as string);
      const stage = document.querySelector<HTMLElement>('[data-testid="november-stage"]')!;
      const scale = Number(stage.dataset.stageScale || 1);
      const sr = stage.getBoundingClientRect();
      const S = (r: DOMRect) => ({
        l: (r.left - sr.left) / scale, t: (r.top - sr.top) / scale,
        r: (r.right - sr.left) / scale, b: (r.bottom - sr.top) / scale,
      });
      const content = [...stage.children].find((el) => (el as HTMLElement).style.zIndex === "1")!;
      const visible = (el: Element) => {
        for (let e: Element | null = el; e && e !== stage; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
        }
        return true;
      };
      const label = (el: Element) => el.textContent!.trim().replace(/\s+/g, " ").slice(0, 40);
      const issues: string[] = [];
      for (const el of content.querySelectorAll<HTMLElement>("*")) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim());
        if (!own.length || !visible(el)) continue;
        const range = document.createRange();
        range.setStart(own[0], 0);
        const last = own[own.length - 1] as Text;
        range.setEnd(last, last.length);
        const rr = range.getBoundingClientRect();
        if (!rr.width || !rr.height) continue;
        const cs = getComputedStyle(el);
        // Text box: across = the text run (cut to the element when it clips
        // its own overflow); down = the laid-out lines. The font's content
        // area overhangs a line-height:1 box by a few px with no glyph cut.
        const er = S(el.getBoundingClientRect());
        const b = S(rr);
        if (cs.overflowX !== "visible") { b.l = Math.max(b.l, er.l); b.r = Math.min(b.r, er.r); }
        if (cs.display.startsWith("inline")) {
          const k = 0.12 * parseFloat(cs.fontSize) * ((er.b - er.t) / (el.offsetHeight || er.b - er.t || 1));
          b.t += k; b.b -= k;
        } else { b.t = Math.max(b.t, er.t); b.b = Math.min(b.b, er.b); }

        // Only a team name may end in "…" (as on every other month).
        const nameCut = cs.textOverflow === "ellipsis" && TEAM_NAME.test(label(el));
        if (cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1 && !nameCut)
          issues.push(`overflows its box across: "${label(el)}" ${el.scrollWidth}>${el.clientWidth}`);
        if (cs.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 2)
          issues.push(`overflows its box down: "${label(el)}" ${el.scrollHeight}>${el.clientHeight}`);
        for (let p = el.parentElement; p && p !== stage.parentElement; p = p.parentElement) {
          const pc = getComputedStyle(p);
          if (pc.overflowX === "visible" && pc.overflowY === "visible") continue;
          const pb = S(p.getBoundingClientRect());
          const over = { top: pb.t - b.t, bottom: b.b - pb.b, left: pb.l - b.l, right: b.r - pb.r };
          for (const [edge, px] of Object.entries(over))
            if (px > 3) issues.push(`cut at the ${edge}: "${label(el)}" by ${Math.round(px)}px`);
        }
        if (b.b > (rowTop as number)) issues.push(`under the turkeys: "${label(el)}" bottom ${Math.round(b.b)}`);
        if (b.l < 0 || b.r > 1600 || b.t < 0) issues.push(`off the stage: "${label(el)}"`);
      }
      // Cards, plates and pictures end above the turkeys too.
      for (const el of content.querySelectorAll<HTMLElement>("*")) {
        const cs = getComputedStyle(el);
        const filled = cs.backgroundColor !== "rgba(0, 0, 0, 0)" || parseFloat(cs.borderTopWidth) > 0 || el.tagName === "IMG";
        if (!filled || !visible(el)) continue;
        const b = S(el.getBoundingClientRect());
        if (b.b - b.t < 2 || b.b - b.t > 640) continue;
        if (b.b > (rowTop as number) + 1) issues.push(`card under the turkeys: "${label(el).slice(0, 20)}" bottom ${Math.round(b.b)}`);
      }
      const whole = (id: string) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        // Whole across: no "…" on it or inside it, and no wider than its box.
        // (Down is covered above: a big display line overhangs its own box
        // by design, and any clipping ancestor is checked edge by edge.)
        if (!el) return "absent";
        const cut = [el, ...el.querySelectorAll("*")].some((e) => getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1);
        return cut || el.scrollWidth > el.clientWidth + 1 ? `cut ${el.scrollWidth}>${el.clientWidth}` : "whole";
      };
      return { scale, issues: [...new Set(issues)], winnerNameWhole: whole("tv-finale-winner-name"), answerWhole: whole("tv-reveal-correct") };
    }, [ROW_TOP, TEAM_NAMES.source] as const);

    expect(report.scale).toBe(1);
    expect(report.issues).toEqual([]);
    expect(["whole", "absent"]).toContain(report.winnerNameWhole);
    expect(["whole", "absent"]).toContain(report.answerWhole);
    if (c.root === "tv-finale-winner") expect(report.winnerNameWhole).toBe("whole");
    else if (c.root === "tv-reveal" && c.text === "CORRECT ANSWER") expect(report.answerWhole).toBe("whole");
  });
}
