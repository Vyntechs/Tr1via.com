import { describe, expect, it } from "vitest";
import {
  deriveDeliveryReceipt,
  type LiveRevision,
  type SurfaceObservation,
} from "@/lib/host/gameDelivery";

const NOW = new Date("2026-07-20T02:00:00.000Z");

const CANONICAL: LiveRevision = {
  runId: "r1",
  roomRevision: 9,
  controlRevision: 4,
  playId: "p1",
};

function observation(
  surfaceKind: SurfaceObservation["surfaceKind"],
  subjectKey: string,
  overrides: Partial<SurfaceObservation> = {},
): SurfaceObservation {
  return {
    surfaceKind,
    subjectKey,
    runId: CANONICAL.runId,
    roomRevision: CANONICAL.roomRevision,
    controlRevision: CANONICAL.controlRevision,
    playId: CANONICAL.playId,
    observedAt: new Date(NOW.getTime() - 10_000),
    ...overrides,
  };
}

describe("deriveDeliveryReceipt", () => {
  it("reports exact, fresh canonical observations as current", () => {
    const observations = [
      observation("tv", "venue-tv"),
      ...Array.from({ length: 30 }, (_, index) =>
        observation("player", `player-${index + 1}`),
      ),
      observation("player", "player-31", {
        observedAt: new Date(NOW.getTime() - 46_000),
      }),
    ];

    const activePlayerSubjects = new Set(
      Array.from({ length: 31 }, (_, index) => `player-${index + 1}`),
    );

    expect(
      deriveDeliveryReceipt(observations, CANONICAL, activePlayerSubjects, NOW),
    ).toEqual({
      tv: "current",
      currentPhones: 30,
      recoveringPhones: 1,
    });
  });

  it.each(
    [
      ["run", { runId: "another-run" }],
      ["room revision", { roomRevision: 10 }],
      ["control revision", { controlRevision: 5 }],
      ["play", { playId: "another-play" }],
    ] satisfies Array<[string, Partial<SurfaceObservation>]>,
  )(
    "classifies an observation with a mismatched %s as recovering",
    (_label, mismatch) => {
      const observations = [
        observation("tv", "venue-tv", mismatch),
        observation("player", "player-1", mismatch),
      ];

      expect(
        deriveDeliveryReceipt(observations, CANONICAL, new Set(["player-1"]), NOW),
      ).toEqual({
        tv: "recovering",
        currentPhones: 0,
        recoveringPhones: 1,
      });
    },
  );

  it("accepts the 45-second boundary but rejects older, future, and invalid dates", () => {
    const observations = [
      observation("tv", "venue-tv", {
        observedAt: new Date(NOW.getTime() - 45_000),
      }),
      observation("player", "boundary", {
        observedAt: new Date(NOW.getTime() - 45_000),
      }),
      observation("player", "old", {
        observedAt: new Date(NOW.getTime() - 45_001),
      }),
      observation("player", "future", {
        observedAt: new Date(NOW.getTime() + 1),
      }),
      observation("player", "invalid", { observedAt: "not-a-date" }),
    ];

    expect(
      deriveDeliveryReceipt(
        observations,
        CANONICAL,
        new Set(["boundary", "old", "future", "invalid"]),
        NOW,
      ),
    ).toEqual({
      tv: "current",
      currentPhones: 1,
      recoveringPhones: 3,
    });
  });

  it("counts only exact active non-removed player subjects", () => {
    const observations = [
      observation("player", "active-1"),
      observation("player", "active-1"),
      observation("player", "removed-or-extra"),
    ];

    expect(
      deriveDeliveryReceipt(
        observations,
        CANONICAL,
        new Set(["active-1", "active-2"]),
        NOW,
      ),
    ).toEqual({
      tv: "recovering",
      currentPhones: 1,
      recoveringPhones: 1,
    });
  });

  it("never calls an observation current without a canonical run identity", () => {
    const canonical = { ...CANONICAL, runId: null };
    const observations = [
      observation("tv", "venue-tv", { runId: null }),
      observation("player", "player-1", { runId: null }),
    ];

    expect(
      deriveDeliveryReceipt(observations, canonical, new Set(["player-1"]), NOW),
    ).toEqual({
      tv: "recovering",
      currentPhones: 0,
      recoveringPhones: 1,
    });
  });

  it("treats an empty active-player set as no expected phones", () => {
    expect(
      deriveDeliveryReceipt(
        [observation("player", "removed-or-extra")],
        CANONICAL,
        new Set(),
        NOW,
      ),
    ).toEqual({
      tv: "recovering",
      currentPhones: 0,
      recoveringPhones: 0,
    });
  });
});
