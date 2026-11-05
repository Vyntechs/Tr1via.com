// The answer window lives in two places: SQL's save trigger and
// questionDurationFor in the app. If they drift, the app accepts answers the
// database refuses, or closes questions the database would still let in.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import { THEME_KEYS } from "@/lib/theme/tokens";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

/** The newest migration wins, so a later redefinition is what gets compared. */
function sqlDeadlineSeconds(): number {
  const newest = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))
    .filter((sql) => /function public\.enforce_legacy_answer_deadline\(/.test(sql))
    .at(-1);
  const match = newest?.match(
    /new\.locked_at >= v_question\.played_at \+ interval '(\d+) seconds'/,
  );
  if (!match) throw new Error("legacy deadline not found in any migration");
  return Number(match[1]);
}

describe("answer deadline contract", () => {
  it("SQL's window equals the app's default window", () => {
    expect(sqlDeadlineSeconds()).toBe(questionDurationFor(undefined));
  });

  it.each(THEME_KEYS)("SQL's window equals the %s theme's window", (themeKey) => {
    expect(sqlDeadlineSeconds()).toBe(questionDurationFor(themeKey));
  });
});
