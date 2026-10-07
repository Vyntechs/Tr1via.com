// Pins how the generate route uses the refill time stops. The stops themselves
// are tested with a pretend clock in collect-verified-questions-clock.test.ts;
// this file only fails if the route stops handing the clock to the collector
// (deleting `startedAtMs` or the limits would otherwise leave every other test
// green and silently remove the protection).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  "app/api/categories/[id]/generate/route.ts",
  "utf8",
);

function constantMs(name: string): number {
  const match = route.match(new RegExp(`const ${name} = ([0-9_]+);`));
  if (!match) throw new Error(`route no longer defines ${name}`);
  return Number(match[1]!.replaceAll("_", ""));
}

describe("category generation refill time stops wiring", () => {
  it("defines both refill limits, below the photo cutoff and the 300 s platform limit", () => {
    const refillStop = constantMs("REFILL_STOP_AFTER_MS");
    const roundWouldEnd = constantMs("REFILL_STOP_IF_ROUND_WOULD_END_AFTER_MS");
    const photoStop = constantMs("PHOTO_STOP_AFTER_MS");

    expect(refillStop).toBe(200_000);
    expect(roundWouldEnd).toBe(250_000);
    expect(refillStop).toBeLessThan(roundWouldEnd);
    expect(roundWouldEnd).toBeLessThan(photoStop);
    expect(photoStop).toBeLessThan(300_000);
  });

  it("starts the clock when the request begins and hands it to the background job", () => {
    expect(route).toMatch(
      /export async function POST\([\s\S]*?const startedAtMs = Date\.now\(\);/,
    );
    expect(route).toMatch(/runGenerationJob\(\{[^}]*?\n\s+startedAtMs,\n/);
    expect(route).toContain("startedAtMs: number;");
  });

  it("passes the clock and both limits to the question collector", () => {
    expect(route).toMatch(
      /collectVerifiedQuestions\(\{[\s\S]*?startedAtMs: opts\.startedAtMs,[\s\S]*?stopRefillingAfterMs: REFILL_STOP_AFTER_MS,[\s\S]*?stopRefillingIfRoundWouldEndAfterMs: REFILL_STOP_IF_ROUND_WOULD_END_AFTER_MS,/,
    );
  });

  it("records a stopped refill in the saved build report", () => {
    expect(route).toMatch(
      /onRefillStopped: \([\s\S]*?\) => \{[\s\S]*?qualityReport\.recordRefillStoppedEarly\(\);/,
    );
  });
});
