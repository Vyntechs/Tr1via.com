import { describe, it, expect } from "vitest";
import { hostRecoverySeed } from "@/lib/room/hostRecoverySeed";
import type { RoomSnapshotPayload } from "@/lib/room/roomSnapshotPayload";

// A payload carrying 3 live answers — i.e. a "3 locked in" count the ~5s route
// poll kept current while the host was on degraded WiFi.
const payload = {
  liveAnswers: [{}, {}, {}],
  scores: [],
  allQuestions: [],
} as unknown as RoomSnapshotPayload;

describe("hostRecoverySeed — host board not stale after WiFi recovery (#3)", () => {
  it("returns the last route payload on a backup→direct (recovery) transition", () => {
    const seed = hostRecoverySeed(true, false, payload);
    expect(seed).toBe(payload);
    // The console seeds its lock count from this, so it reads 3 (current), not
    // the stale frozen direct value.
    expect(seed?.liveAnswers.length).toBe(3);
  });

  it("returns null when ENTERING backup mode (direct→backup)", () => {
    expect(hostRecoverySeed(false, true, payload)).toBeNull();
  });

  it("returns null when backup mode is unchanged", () => {
    expect(hostRecoverySeed(true, true, payload)).toBeNull();
    expect(hostRecoverySeed(false, false, payload)).toBeNull();
  });

  it("returns null on recovery when no payload was captured", () => {
    expect(hostRecoverySeed(true, false, null)).toBeNull();
  });
});
