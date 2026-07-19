import { describe, expect, it } from "vitest";

import {
  HostPlayCommandSchema,
  ResilientAnswerSchema,
  ResilientRevealSchema,
} from "@/lib/api/schemas";

const ID = "11111111-1111-4111-8111-111111111111";

describe("resilient live request schemas", () => {
  it("accepts only the exact reveal, answer, and host-play command contracts", () => {
    expect(
      ResilientRevealSchema.parse({
        questionId: ID,
        runId: ID,
        commandId: ID,
        expectedControlRevision: 7,
      }),
    ).toEqual({
      questionId: ID,
      runId: ID,
      commandId: ID,
      expectedControlRevision: 7,
    });
    expect(
      ResilientAnswerSchema.parse({
        playId: ID,
        runId: ID,
        submissionId: ID,
        slotChosen: 4,
      }),
    ).toEqual({ playId: ID, runId: ID, submissionId: ID, slotChosen: 4 });
    expect(
      HostPlayCommandSchema.parse({
        playId: ID,
        runId: ID,
        commandId: ID,
        expectedControlRevision: 7,
      }),
    ).toEqual({
      playId: ID,
      runId: ID,
      commandId: ID,
      expectedControlRevision: 7,
    });
  });

  it.each([
    "playerId",
    "deviceId",
    "scramble",
    "canonicalIndex",
    "correctIndex",
    "reason",
    "deadline",
    "finalWindowEndsAt",
  ])("rejects the forbidden resilient field %s", (field) => {
    const schemasAndBodies = [
      [
        ResilientRevealSchema,
        {
          questionId: ID,
          runId: ID,
          commandId: ID,
          expectedControlRevision: 7,
        },
      ],
      [
        ResilientAnswerSchema,
        { playId: ID, runId: ID, submissionId: ID, slotChosen: 2 },
      ],
      [
        HostPlayCommandSchema,
        {
          playId: ID,
          runId: ID,
          commandId: ID,
          expectedControlRevision: 7,
        },
      ],
    ] as const;

    for (const [schema, body] of schemasAndBodies) {
      expect(schema.safeParse({ ...body, [field]: "attacker-value" }).success).toBe(
        false,
      );
    }
  });
});
