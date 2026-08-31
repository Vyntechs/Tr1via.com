import { afterEach, describe, expect, it } from "vitest";

describe("provider cost guard", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.PEXELS_API_KEY;
  });

  it.each([
    "https://api.anthropic.com/v1/messages",
    "https://api.pexels.com/v1/search?query=guard",
  ])("blocks direct provider requests even when a key was exported: %s", async (url) => {
    process.env.ANTHROPIC_API_KEY = "fake-exported-anthropic-key";
    process.env.PEXELS_API_KEY = "fake-exported-pexels-key";

    await expect(fetch(url)).rejects.toThrow(/provider-cost guard blocked/i);
  });
});
