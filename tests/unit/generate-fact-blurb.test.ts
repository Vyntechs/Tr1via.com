// generateFactBlurb — rewrite ONE fun fact after the host edits a question.
//
// The fun fact is read ALOUD to the room when the answer is revealed, so the
// only two acceptable outcomes are "a fact that matches this question" and
// "no fact". Never a leftover fact from the question this row used to hold —
// that is the 2026-07-29 live bug (issue #173).
//
// Anthropic SDK is mocked; no network.

import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { generateFactBlurb } from "@/lib/ai/generate-fact-blurb";

type CreateArgs = Record<string, unknown>;

/** Minimal stand-in for the Anthropic client: records the request and
 *  replays whatever content blocks the test supplies. */
function makeClient(content: unknown[]) {
  const create = vi.fn().mockResolvedValue({ content });
  return {
    client: { messages: { create } } as unknown as Anthropic,
    create,
  };
}

const QUESTION = {
  prompt: "The square root of 900 is:",
  options: ["25", "30", "40", "35"] as [string, string, string, string],
  correctIndex: 1 as const,
};

function toolBlock(blurb: unknown) {
  return { type: "tool_use", name: "emit_fact_blurb", input: { blurb } };
}

describe("generateFactBlurb", () => {
  it("returns the emitted blurb", async () => {
    const { client } = makeClient([toolBlock("30 x 30 = 900.")]);
    await expect(generateFactBlurb({ ...QUESTION, client })).resolves.toBe(
      "30 x 30 = 900.",
    );
  });

  it("sends the question, its options, and the CORRECT answer spelled out", async () => {
    const { client, create } = makeClient([toolBlock("30 x 30 = 900.")]);
    await generateFactBlurb({ ...QUESTION, client });

    const args = create.mock.calls[0]![0] as CreateArgs;
    const userText = (args.messages as { content: string }[])[0]!.content;
    expect(userText).toContain("The square root of 900 is:");
    // Spelling out the answer matters: the model must explain THE MARKED
    // answer, not whichever option it believes is right.
    expect(userText).toContain("The correct answer is: 30");
    expect(args.tool_choice).toEqual({ type: "tool", name: "emit_fact_blurb" });
  });

  it("returns null — never a guess — when Claude emits no tool call", async () => {
    const { client } = makeClient([{ type: "text", text: "Sure! Here you go." }]);
    await expect(generateFactBlurb({ ...QUESTION, client })).resolves.toBeNull();
  });

  it("returns null when the blurb is too long for the PATCH that will store it", async () => {
    const { client } = makeClient([toolBlock("x".repeat(281))]);
    await expect(generateFactBlurb({ ...QUESTION, client })).resolves.toBeNull();
  });

  it("returns null on an empty or non-string blurb", async () => {
    for (const bad of ["", "   ", 42, null, undefined]) {
      const { client } = makeClient([toolBlock(bad)]);
      await expect(generateFactBlurb({ ...QUESTION, client })).resolves.toBeNull();
    }
  });

  it("does not use Haiku by default — this string is read out as truth", async () => {
    const { client, create } = makeClient([toolBlock("30 x 30 = 900.")]);
    await generateFactBlurb({ ...QUESTION, client });
    const model = (create.mock.calls[0]![0] as CreateArgs).model as string;
    expect(model).not.toMatch(/haiku/i);
  });
});
