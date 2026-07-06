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

    expect(workflow).toMatch(/timeout-minutes:\s*15/);
    expect(workflow).toContain(`SMOKE_GEN_TIMEOUT_MS: ${DEFAULT_GEN_TIMEOUT_MS}`);
    expect(workflow).toMatch(
      /Full-flow driver[\s\S]*?timeout-minutes:\s*8/,
    );
  });

  it("allows a one-off override for manual investigations", () => {
    expect(genTimeoutFromEnv({ SMOKE_GEN_TIMEOUT_MS: "123456" })).toBe(123_456);
  });
});
