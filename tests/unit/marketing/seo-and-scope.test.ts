// Heather-safe scope guard for the marketing pass.
//
// The marketing redesign must never touch the live host / player / TV / API /
// theme-engine / DB surface — a real host runs a real game on production, and
// this work is purely additive marketing pages. This test fails loudly if any
// file changed by the marketing build lands inside a PROTECTED runtime path.
//
// Design choice: a DENY-list (protected runtime paths), not an allow-list.
//   - Robust: it can't be defeated by forgetting to allow a new safe file, and
//     it doesn't false-positive on bookkeeping files (HANDOFF.md, tasks/…).
//   - Precise about intent: the constraint is "don't touch what Heather's game
//     uses," which is exactly these directories.
//
// Baseline: changes are measured against the `marketing-base` git tag, set to
// the commit the build started from. If the tag is absent (e.g. a fresh CI
// checkout), we fall back to the working-tree diff vs HEAD — which still
// catches any uncommitted edit into a protected path. This is a development
// guard; a permanent CI/deploy gate is tracked separately (lesson
// `merge-is-not-migrated`).

import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";

// Paths Heather's live game depends on — NONE may be modified by this pass.
const PROTECTED: RegExp[] = [
  /^app\/host\//,
  /^app\/\(host\)\//,
  /^app\/\(player\)\//,
  /^app\/tv\//,
  /^app\/api\//,
  /^app\/dev\//,
  /^lib\//, // theme engine + runtime helpers — consumed read-only, never edited
  /^supabase\//,
  /^app\/globals\.css$/, // app-wide stylesheet
  /^app\/themes\.generated\.css$/, // generated theme CSS (changing it = theme change)
  /^app\/layout\.tsx$/, // root layout (shared by every surface)
  /^components\/(?!marketing\/)/, // any shared component outside components/marketing
];

function changedFiles(): string[] {
  // No shell: execFileSync passes args directly to git (no interpolation risk).
  const baseline = (() => {
    try {
      execFileSync("git", ["rev-parse", "--verify", "--quiet", "marketing-base"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      return "marketing-base";
    } catch {
      return "HEAD";
    }
  })();
  const out = execFileSync("git", ["diff", "--name-only", baseline], { encoding: "utf8" });
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

describe("marketing pass · Heather-safe scope guard", () => {
  it("changes no file the live host/player/TV/API/theme/DB surface depends on", () => {
    const changed = changedFiles();
    const violations = changed.filter((f) => PROTECTED.some((re) => re.test(f)));
    expect(
      violations,
      `Marketing pass touched PROTECTED runtime files (Heather's live game depends on these):\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("marketing pass · SEO must not regress", () => {
  it("the hub keeps its canonical URL, title, description, and keyword targeting", async () => {
    const { metadata } = await import("@/app/(marketing)/trivia-night/page");
    expect(metadata.alternates?.canonical).toBe("https://tr1via.com/trivia-night");
    expect(metadata.title).toBe("Host a live trivia night — free");
    expect((metadata.description as string)).toMatch(/nobody can cheat/i);
    expect(metadata.keywords).toContain("free trivia night software");
    expect((metadata.openGraph as { url?: string })?.url).toBe("https://tr1via.com/trivia-night");
  });

  it("/pricing keeps its own canonical + FAQ-friendly metadata", async () => {
    const { metadata } = await import("@/app/(marketing)/pricing/page");
    expect(metadata.alternates?.canonical).toBe("https://tr1via.com/pricing");
    expect((metadata.description as string)).toMatch(/\$4\.99/);
  });
});
