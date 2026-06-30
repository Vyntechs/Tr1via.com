import { describe, expect, it } from "vitest";

import {
  ROOM_MAGIC_REACTION_KINDS,
  ROOM_MAGIC_REACTION_LABELS,
  isRoomMagicReactionKind,
} from "@/lib/room-magic/reactions";

describe("room magic reactions", () => {
  it("supports the four approved bounded reactions", () => {
    expect(ROOM_MAGIC_REACTION_KINDS).toEqual([
      "applause",
      "nice_one",
      "wow",
      "brutal",
    ]);
    expect(ROOM_MAGIC_REACTION_LABELS.brutal).toBe("Brutal");
  });

  it("rejects unknown values", () => {
    expect(isRoomMagicReactionKind("wow")).toBe(true);
    expect(isRoomMagicReactionKind("chat")).toBe(false);
    expect(isRoomMagicReactionKind(null)).toBe(false);
  });
});
