import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  DEFAULT_GEN_TIMEOUT_MS,
  genTimeoutFromEnv,
} from "../../scripts/prod-smoke-config.mjs";

describe("prod smoke generation budget", () => {
  it("waits longer than the observed 90 second generation edge by default", () => {
    expect(DEFAULT_GEN_TIMEOUT_MS).toBe(240_000);
    expect(genTimeoutFromEnv({})).toBe(DEFAULT_GEN_TIMEOUT_MS);
  });

  it("keeps the GitHub Actions timeout budget aligned with the script", () => {
    const workflow = readFileSync(".github/workflows/prod-smoke.yml", "utf8");
    const fullFlow = readFileSync("scripts/full-flow-prod.mjs", "utf8");
    const fullFlowStep = workflow.match(
      /- name: Full-flow driver[\s\S]*?run: node scripts\/full-flow-prod\.mjs/,
    )?.[0];

    expect(workflow).toMatch(/timeout-minutes:\s*15/);
    expect(fullFlow).toContain(
      'import { genTimeoutFromEnv } from "./prod-smoke-config.mjs";',
    );
    expect(fullFlow).toContain("const GEN_TIMEOUT_MS = genTimeoutFromEnv();");
    expect(fullFlowStep).toContain("timeout-minutes: 12");
    expect(fullFlowStep).toContain("CATEGORIES_PER_GAME: 1");
    expect(fullFlowStep).toContain(
      `SMOKE_GEN_TIMEOUT_MS: ${DEFAULT_GEN_TIMEOUT_MS}`,
    );
  });

  it("allows a one-off override for manual investigations", () => {
    expect(genTimeoutFromEnv({ SMOKE_GEN_TIMEOUT_MS: "123456" })).toBe(123_456);
  });
});
