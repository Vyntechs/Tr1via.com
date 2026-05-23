// Smoke test for the MSW Anthropic + Pexels handlers.
//
// We don't boot MSW at the Vitest setup level (no global `setupFiles`
// entry) because most unit tests don't need it. Instead this spec opens
// its own server lifecycle so the mocks are only active for these tests.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { mockServer, resetAnthropicMock } from "../mocks/server";

describe("MSW mocks", () => {
  beforeAll(() => {
    mockServer.listen({ onUnhandledRequest: "bypass" });
  });
  afterAll(() => {
    mockServer.close();
  });

  it("intercepts Anthropic and returns 20 questions in emit_questions tool_use shape", async () => {
    resetAnthropicMock();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "test",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: "pixar movies" }],
      }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.content[0].type).toBe("tool_use");
    expect(body.content[0].name).toBe("emit_questions");
    expect(body.content[0].input.questions).toHaveLength(20);
    // Sanity-check the shape of the first question — should pass the
    // production Zod schema.
    const q = body.content[0].input.questions[0];
    expect(q.options).toHaveLength(4);
    expect(typeof q.correctIndex).toBe("number");
    expect(typeof q.difficulty).toBe("number");
    expect(q.factBlurb.length).toBeGreaterThan(8);
    expect(q.photoQuery.length).toBeGreaterThan(2);
  });

  it("returns the retry set on second call", async () => {
    resetAnthropicMock();
    await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: "{}",
    }); // call 1
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: '{"messages":[{"content":"more questions"}]}',
    }); // call 2
    const body = await res.json();
    expect(body.content[0].input.questions).toHaveLength(5);
  });

  it("intercepts Pexels and returns 12 photos", async () => {
    const res = await fetch(
      "https://api.pexels.com/v1/search?query=pixar&per_page=12",
    );
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.photos).toHaveLength(12);
    expect(body.photos[0].src.large2x).toMatch(/placehold\.co/);
  });
});
