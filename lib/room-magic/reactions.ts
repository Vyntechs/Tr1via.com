export const ROOM_MAGIC_REACTION_KINDS = [
  "applause",
  "nice_one",
  "wow",
  "brutal",
] as const;

export type RoomMagicReactionKind = (typeof ROOM_MAGIC_REACTION_KINDS)[number];

export const ROOM_MAGIC_REACTION_LABELS: Record<RoomMagicReactionKind, string> = {
  applause: "Applause",
  nice_one: "Nice one",
  wow: "Wow",
  brutal: "Brutal",
};

export interface RoomMagicReactionEvent {
  kind: RoomMagicReactionKind;
  questionId: string;
  playerId: string;
  serverNow: string;
}

export function isRoomMagicReactionKind(
  value: unknown,
): value is RoomMagicReactionKind {
  return (
    typeof value === "string" &&
    ROOM_MAGIC_REACTION_KINDS.includes(value as RoomMagicReactionKind)
  );
}
