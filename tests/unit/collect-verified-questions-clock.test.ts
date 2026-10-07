// The checking loop's time cutoff. Everything is pretend: the clock is a number
// the test moves, and the writer and checker are fakes (no AI calls, no
// network). Pins that a fast build runs every round it needs, and that a build
// past the cutoff starts no new round but still finishes cleanly.

import { describe, expect, it } from "vitest";
import {
  collectVerifiedQuestions,
  type CollectVerifiedRoundEvent,
} from "@/lib/ai/collect-verified-questions";
import type { GeneratedQuestion } from "@/lib/ai/generate-questions";
import { createQuestionGenerationReportAccumulator } from "@/lib/ai/question-generation-report";
import type { AnswerVerdict } from "@/lib/ai/verify-answers";

const STOP_AFTER_MS = 200_000;
const ROUND_WOULD_END_AFTER_MS = 250_000;

function q(prompt: string): GeneratedQuestion {
  return {
    prompt,
    options: ["a", "b", "c", "d"],
    correctIndex: 0,
    difficulty: 4,
    factBlurb: "A plain fact blurb.",
    photoQuery: "q",
  };
}

const ok = (index: number): AnswerVerdict => ({
  index,
  markedAnswerIsCorrect: true,
  ambiguous: false,
  factBlurbIsCorrect: true,
  answerableWithoutImage: true,
  fitsRequestedTopic: true,
});
const wrong = (index: number): AnswerVerdict => ({
  ...ok(index),
  markedAnswerIsCorrect: false,
});

/** Each round writes 3 questions: one good, two the checker rejects. */
function fakeBuild(clock: { t: number }, msPerRound: number) {
  const calls = { generate: 0, verify: 0, onAccepted: 0 };
  const accepted: string[][] = [];
  return {
    calls,
    accepted,
    generate: async () => {
      calls.generate += 1;
      clock.t += msPerRound;
      const n = calls.generate;
      return [q(`r${n}-good`), q(`r${n}-bad1`), q(`r${n}-bad2`)];
    },
    verify: async (batch: GeneratedQuestion[]) => {
      calls.verify += 1;
      return batch.map((item, i) => (item.prompt.endsWith("good") ? ok(i) : wrong(i)));
    },
    onAccepted: (batch: GeneratedQuestion[]) => {
      calls.onAccepted += 1;
      accepted.push(batch.map((item) => item.prompt));
    },
  };
}

describe("collectVerifiedQuestions time cutoff", () => {
  it("a fast build still runs every round it needs", async () => {
    const clock = { t: 1_000_000 };
    const startedAtMs = clock.t;
    const fake = fakeBuild(clock, 20_000); // 4 rounds = 80 s, well under 200 s
    const events: CollectVerifiedRoundEvent[] = [];
    const stopped: unknown[] = [];

    const out = await collectVerifiedQuestions({
      target: 4,
      maxRounds: 4,
      now: () => clock.t,
      startedAtMs,
      stopRefillingAfterMs: STOP_AFTER_MS,
      onRefillStopped: (event) => {
        stopped.push(event);
      },
      generate: fake.generate,
      verify: fake.verify,
      onAccepted: fake.onAccepted,
      onRoundComplete: (event) => {
        events.push(event);
      },
    });

    expect(out.map((item) => item.prompt)).toEqual([
      "r1-good",
      "r2-good",
      "r3-good",
      "r4-good",
    ]);
    expect(fake.calls.generate).toBe(4);
    expect(stopped).toEqual([]);
    expect(events.map((event) => event.durationMs)).toEqual([20_000, 20_000, 20_000, 20_000]);
  });

  it("a build past 200 s starts no new round and finishes with what it has", async () => {
    const clock = { t: 5_000_000 };
    const startedAtMs = clock.t;
    // Round 1 alone takes 210 s of pretend time (a very slow build).
    const fake = fakeBuild(clock, 210_000);
    const events: CollectVerifiedRoundEvent[] = [];
    const stopped: Array<{ round: number; elapsedMs: number }> = [];

    const out = await collectVerifiedQuestions({
      target: 4,
      maxRounds: 4,
      now: () => clock.t,
      startedAtMs,
      stopRefillingAfterMs: STOP_AFTER_MS,
      onRefillStopped: (event) => {
        stopped.push(event);
      },
      generate: fake.generate,
      verify: fake.verify,
      onAccepted: fake.onAccepted,
      onRoundComplete: (event) => {
        events.push(event);
      },
    });

    // Round 1 ran and was saved; round 2 never started.
    expect(fake.calls.generate).toBe(1);
    expect(fake.calls.verify).toBe(2); // round 1's two checks, nothing after
    expect(out.map((item) => item.prompt)).toEqual(["r1-good"]);
    expect(fake.accepted).toEqual([["r1-good"]]);
    expect(stopped).toEqual([{ round: 2, elapsedMs: 210_000 }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ round: 1, accepted: 1, durationMs: 210_000 });
  });

  it("stops exactly past the limit, not at it", async () => {
    for (const [elapsed, shouldRefill] of [
      [STOP_AFTER_MS, true],
      [STOP_AFTER_MS + 1, false],
    ] as const) {
      const clock = { t: 0 };
      const fake = fakeBuild(clock, elapsed);
      await collectVerifiedQuestions({
        target: 2,
        maxRounds: 2,
        now: () => clock.t,
        startedAtMs: 0,
        stopRefillingAfterMs: STOP_AFTER_MS,
        generate: fake.generate,
        verify: fake.verify,
        onAccepted: fake.onAccepted,
      });
      expect(fake.calls.generate).toBe(shouldRefill ? 2 : 1);
    }
  });

  it("does not stop on its own: with no cutoff given, time never matters", async () => {
    const clock = { t: 0 };
    const fake = fakeBuild(clock, 500_000);

    const out = await collectVerifiedQuestions({
      target: 3,
      maxRounds: 4,
      now: () => clock.t,
      generate: fake.generate,
      verify: fake.verify,
    });

    expect(fake.calls.generate).toBe(3);
    expect(out).toHaveLength(3);
  });

  it("keeps the same retry limit: a fast build still stops at maxRounds", async () => {
    const clock = { t: 0 };
    const fake = fakeBuild(clock, 1_000);

    const out = await collectVerifiedQuestions({
      target: 20,
      maxRounds: 4,
      now: () => clock.t,
      startedAtMs: 0,
      stopRefillingAfterMs: STOP_AFTER_MS,
      generate: fake.generate,
      verify: fake.verify,
    });

    expect(fake.calls.generate).toBe(4);
    expect(out).toHaveLength(4);
  });

  it("the saved report carries each round's time and says the clock stopped it", async () => {
    const clock = { t: 0 };
    const fake = fakeBuild(clock, 130_000);
    const report = createQuestionGenerationReportAccumulator({
      requestedCount: 4,
      verifyPasses: 2,
    });

    const out = await collectVerifiedQuestions({
      target: 4,
      maxRounds: 4,
      now: () => clock.t,
      startedAtMs: 0,
      stopRefillingAfterMs: STOP_AFTER_MS,
      onRefillStopped: () => report.recordRefillStoppedEarly(),
      generate: fake.generate,
      verify: fake.verify,
      onRoundComplete: (event) => {
        report.recordRound({
          round: event.round,
          requested: event.requested,
          generated: event.generated,
          accepted: event.accepted,
          rejected: event.rejected,
          durationMs: event.durationMs,
        });
      },
    });
    report.recordAcceptedQuestions(out);
    const snapshot = report.snapshot("partial");

    // Round 1 ends at 130 s (under the limit), round 2 ends at 260 s, so
    // round 3 is never started.
    expect(fake.calls.generate).toBe(2);
    expect(snapshot.report.rounds.map((round) => round.durationMs)).toEqual([130_000, 130_000]);
    expect(snapshot.report.refillStoppedEarly).toBe(true);
    expect(snapshot.acceptedCount).toBe(2);
  });

  describe("second cutoff: skip a round that would probably end too late", () => {
    it("stops when 180 s have passed and the last round took 80 s (180 + 80 > 250)", async () => {
      const clock = { t: 10_000_000 };
      // Round 1 starts 100 s into the build and takes 80 s: round 2 would start
      // at 180 s, which is under the 200 s cutoff, so only the new rule fires.
      const startedAtMs = clock.t - 100_000;
      const fake = fakeBuild(clock, 80_000);
      const stopped: Array<{ round: number; elapsedMs: number }> = [];

      const out = await collectVerifiedQuestions({
        target: 4,
        maxRounds: 4,
        now: () => clock.t,
        startedAtMs,
        stopRefillingAfterMs: STOP_AFTER_MS,
        stopRefillingIfRoundWouldEndAfterMs: ROUND_WOULD_END_AFTER_MS,
        onRefillStopped: (event) => {
          stopped.push(event);
        },
        generate: fake.generate,
        verify: fake.verify,
        onAccepted: fake.onAccepted,
      });

      expect(fake.calls.generate).toBe(1);
      expect(fake.calls.verify).toBe(2);
      expect(out.map((item) => item.prompt)).toEqual(["r1-good"]);
      expect(fake.accepted).toEqual([["r1-good"]]);
      expect(stopped).toEqual([{ round: 2, elapsedMs: 180_000 }]);
    });

    it("keeps going when 180 s have passed but the last round took only 30 s (180 + 30 <= 250)", async () => {
      const clock = { t: 10_000_000 };
      const startedAtMs = clock.t - 150_000;
      const fake = fakeBuild(clock, 30_000);
      const stopped: unknown[] = [];

      const out = await collectVerifiedQuestions({
        target: 2,
        maxRounds: 4,
        now: () => clock.t,
        startedAtMs,
        stopRefillingAfterMs: STOP_AFTER_MS,
        stopRefillingIfRoundWouldEndAfterMs: ROUND_WOULD_END_AFTER_MS,
        onRefillStopped: (event) => {
          stopped.push(event);
        },
        generate: fake.generate,
        verify: fake.verify,
        onAccepted: fake.onAccepted,
      });

      expect(fake.calls.generate).toBe(2);
      expect(out.map((item) => item.prompt)).toEqual(["r1-good", "r2-good"]);
      expect(stopped).toEqual([]);
    });

    it("stops past the limit, not at it", async () => {
      for (const [previousRoundMs, shouldRefill] of [
        [70_000, true], // 180 s elapsed + 70 s = exactly 250 s: still goes
        [70_001, false], // one millisecond over: stops
      ] as const) {
        const clock = { t: 0 };
        const fake = fakeBuild(clock, previousRoundMs);
        await collectVerifiedQuestions({
          target: 2,
          maxRounds: 2,
          now: () => clock.t,
          // Round 2 starts at 180 s: round 1 starts at (180 s - its length).
          startedAtMs: -(180_000 - previousRoundMs),
          stopRefillingIfRoundWouldEndAfterMs: ROUND_WOULD_END_AFTER_MS,
          generate: fake.generate,
          verify: fake.verify,
        });
        expect(fake.calls.generate).toBe(shouldRefill ? 2 : 1);
      }
    });

    it("never skips round 1, even when the build is already late", async () => {
      const clock = { t: 10_000_000 };
      const fake = fakeBuild(clock, 5_000);

      const out = await collectVerifiedQuestions({
        target: 1,
        maxRounds: 4,
        now: () => clock.t,
        // 190 s in (past 180 s, under the 200 s cutoff); no round has run yet,
        // so there is no earlier round to add and the new rule has nothing to say.
        startedAtMs: clock.t - 190_000,
        stopRefillingAfterMs: STOP_AFTER_MS,
        stopRefillingIfRoundWouldEndAfterMs: ROUND_WOULD_END_AFTER_MS,
        generate: fake.generate,
        verify: fake.verify,
      });

      expect(fake.calls.generate).toBe(1);
      expect(out.map((item) => item.prompt)).toEqual(["r1-good"]);
    });

    it("a fast build never stops early, and the 4-round limit still applies", async () => {
      const clock = { t: 0 };
      const fake = fakeBuild(clock, 10_000);
      const stopped: unknown[] = [];

      const out = await collectVerifiedQuestions({
        target: 20,
        maxRounds: 4,
        now: () => clock.t,
        startedAtMs: 0,
        stopRefillingAfterMs: STOP_AFTER_MS,
        stopRefillingIfRoundWouldEndAfterMs: ROUND_WOULD_END_AFTER_MS,
        onRefillStopped: (event) => {
          stopped.push(event);
        },
        generate: fake.generate,
        verify: fake.verify,
      });

      expect(fake.calls.generate).toBe(4);
      expect(out).toHaveLength(4);
      expect(stopped).toEqual([]);
    });

    it("needs the build start time, like the first cutoff: without it, no stop", async () => {
      const clock = { t: 0 };
      const fake = fakeBuild(clock, 300_000);

      const out = await collectVerifiedQuestions({
        target: 3,
        maxRounds: 4,
        now: () => clock.t,
        stopRefillingIfRoundWouldEndAfterMs: ROUND_WOULD_END_AFTER_MS,
        generate: fake.generate,
        verify: fake.verify,
      });

      expect(fake.calls.generate).toBe(3);
      expect(out).toHaveLength(3);
    });

    it("the saved report records the stop", async () => {
      const clock = { t: 10_000_000 };
      const fake = fakeBuild(clock, 80_000);
      const report = createQuestionGenerationReportAccumulator({
        requestedCount: 4,
        verifyPasses: 2,
      });

      const out = await collectVerifiedQuestions({
        target: 4,
        maxRounds: 4,
        now: () => clock.t,
        startedAtMs: clock.t - 100_000,
        stopRefillingAfterMs: STOP_AFTER_MS,
        stopRefillingIfRoundWouldEndAfterMs: ROUND_WOULD_END_AFTER_MS,
        onRefillStopped: () => report.recordRefillStoppedEarly(),
        generate: fake.generate,
        verify: fake.verify,
        onRoundComplete: (event) => {
          report.recordRound({
            round: event.round,
            requested: event.requested,
            generated: event.generated,
            accepted: event.accepted,
            rejected: event.rejected,
            durationMs: event.durationMs,
          });
        },
      });
      report.recordAcceptedQuestions(out);
      const snapshot = report.snapshot("partial");

      expect(fake.calls.generate).toBe(1);
      expect(snapshot.report.rounds.map((round) => round.durationMs)).toEqual([80_000]);
      expect(snapshot.report.refillStoppedEarly).toBe(true);
      expect(snapshot.acceptedCount).toBe(1);
    });
  });
});
