// Zod input schemas shared across API route handlers.
//
// Centralising them here keeps every route's body shape verifiable in one
// place and lets us export inferred TypeScript types for use in client code
// (e.g. the form posting to the route). All schemas are conservative —
// trim strings, clamp numbers, reject extra fields by default.
//
// Why a single file: most TR1VIA payloads are small, and a few schemas
// (room code, uuid, theme key) recur across many routes. A single import
// avoids subtle drift between routes that all "took the same shape".

import { z } from "zod";
import { ALPHABET } from "@/lib/game/room-code";

const THEME_KEYS = [
  "house",
  "daylight",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

export const ThemeKeySchema = z.enum(THEME_KEYS);

// 6 ALPHABET chars; uppercase only. Frontends should normalize via
// parseRoomCode() before sending.
export const RoomCodeSchema = z
  .string()
  .length(6)
  .regex(new RegExp(`^[${ALPHABET}]{6}$`), "invalid room code");

export const UuidSchema = z.string().uuid();

export const SlotChosenSchema = z
  .number()
  .int()
  .min(1)
  .max(4);

// A scramble is a permutation of [0,1,2,3]. We verify it's a permutation in
// the route — Zod just enforces the shape here.
export const ScrambleSchema = z
  .tuple([
    z.number().int().min(0).max(3),
    z.number().int().min(0).max(3),
    z.number().int().min(0).max(3),
    z.number().int().min(0).max(3),
  ])
  .refine(
    (s) => new Set(s).size === 4,
    { message: "scramble must be a permutation of [0,1,2,3]" },
  );

export const CreateNightSchema = z.object({
  venueName: z.string().trim().min(1).max(120),
  themeKey: ThemeKeySchema.optional(),
  scheduledAt: z.string().datetime().optional(),
});

export const CreatePlayerSchema = z.object({
  nightId: UuidSchema,
  displayName: z.string().trim().min(1).max(40),
});

/** POST /api/nights/[id]/players body — host adds a latecomer. */
export const HostAddPlayerSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
});

export const HeartbeatSchema = z.object({
  appSwitchSeconds: z.number().int().min(0).max(86_400).optional(),
});

export const JoinGameSchema = z.object({
  gameNo: z.number().int().min(1).max(2),
});

export const RevealSchema = z.object({
  questionId: UuidSchema,
});

export const EndEarlySchema = z.object({
  questionId: UuidSchema,
});

export const SubmitAnswerSchema = z.object({
  questionId: UuidSchema,
  slotChosen: SlotChosenSchema,
  scramble: ScrambleSchema,
});

export const AdjustmentSchema = z.object({
  playerId: UuidSchema,
  gameId: UuidSchema,
  delta: z.number().int().min(-10_000).max(10_000),
  reason: z.string().trim().max(200).optional(),
});

export const TopicSuggestionSchema = z.object({
  // 100 char limit per spec; trim incoming whitespace; reject empty.
  text: z.string().trim().min(1).max(100),
});

// ─── Phase 7: question generation + curation ──────────────────────────

const FlavorListSchema = z
  .array(z.string().trim().min(1).max(40))
  .max(8)
  .optional();

const DifficultyTargetSchema = z
  .enum(["easy", "normal", "hard"])
  .optional();

const CorrectIndexSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

const QuestionOptionsTupleSchema = z
  .array(z.string().trim().min(1).max(160))
  .length(4)
  .refine((opts) => new Set(opts.map((o) => o.toLowerCase())).size === 4, {
    message: "options must be four distinct values",
  });

/** POST /api/categories body — host creates a new category in a game. */
export const CreateCategoryBodySchema = z
  .object({
    gameId: UuidSchema,
    name: z.string().trim().min(1).max(80),
    topic: z.string().trim().min(1).max(120),
    position: z.number().int().min(1).max(6),
  })
  .strict();

/**
 * PATCH /api/categories/[id] body — rename the display label.
 *
 * Mutates `categories.name` only. `categories.topic` (the original
 * Claude-generation prompt) is preserved — renaming is purely a host UI
 * affordance, not a regeneration trigger. `.strict()` ensures a stale
 * client trying to send a `topic` payload here gets a clear 400.
 */
export const PatchCategoryBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();

/** POST /api/categories/[id]/generate body. */
export const GenerateCategoryBodySchema = z
  .object({
    flavor: FlavorListSchema,
    difficulty: DifficultyTargetSchema,
    // Present (even empty) ⇒ in-place reroll: keep these picked ids, swap out
    // the rest, and avoid repeating questions already shown. Absent ⇒ first
    // generation from draft (nothing to keep or delete).
    keptIds: z.array(UuidSchema).optional(),
    // Opt-in: when true, after generation completes the background job
    // auto-picks 7 questions (spread across difficulty) and flips the category
    // straight to 'ready' instead of stopping at 'review'. Used by the founder
    // "Build a full game" tool. Default (undefined) preserves manual review.
    autoPick: z.boolean().optional(),
  })
  .strict();

/** POST /api/categories/[id]/pick body — exactly 7 distinct question ids. */
export const PickCategoryBodySchema = z
  .object({
    questionIds: z
      .array(UuidSchema)
      .length(7)
      .refine((ids) => new Set(ids).size === 7, {
        message: "questionIds must contain 7 distinct ids",
      }),
  })
  .strict();

/** A non-null board slot value (100..700). */
const PointSlotSchema = z.union([
  z.literal(100),
  z.literal(200),
  z.literal(300),
  z.literal(400),
  z.literal(500),
  z.literal(600),
  z.literal(700),
]);

/**
 * POST /api/categories/[id]/reorder body — the new board order after a
 * drag-to-reorder of the "YOUR BOARD" sidebar. Each entry pins a picked
 * question to a slot value; ids and slot values must each be distinct, and
 * there must be at least 2 (you can't reorder fewer). At most 7 — the board
 * never holds more.
 */
export const ReorderBoardBodySchema = z
  .object({
    assignments: z
      .array(
        z
          .object({ id: UuidSchema, pointValue: PointSlotSchema })
          .strict(),
      )
      .min(2)
      .max(7)
      .refine(
        (a) => new Set(a.map((x) => x.id)).size === a.length,
        { message: "assignments must reference distinct question ids" },
      )
      .refine(
        (a) => new Set(a.map((x) => x.pointValue)).size === a.length,
        { message: "assignments must use distinct point values" },
      ),
  })
  .strict();

/**
 * One row in a manual-entry submission. Same invariants as a generated
 * question — 4 distinct options, correct_index 0..3, a non-trivial
 * prompt — but the host typed it herself.
 */
const ManualQuestionSchema = z
  .object({
    prompt: z.string().trim().min(4).max(400),
    options: QuestionOptionsTupleSchema,
    correctIndex: CorrectIndexSchema,
    // Optional photo URL. When present, persisted as image_source='upload'
    // so the question row's audit trail makes sense. We store the URL
    // verbatim — the host owns whatever they pasted.
    imageUrl: z
      .string()
      .url()
      .max(2_000)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  })
  .strict();

/**
 * POST /api/categories/[id]/manual body. The host typed 7 questions by
 * hand — generation failed, or she preferred to. Order entered = point
 * order: row 1 becomes the 100-pointer, row 7 becomes the 700-pointer.
 * Difficulty mirrors position (1..7) so the meter reads sensibly.
 */
export const ManualCategoryBodySchema = z
  .object({
    questions: z.array(ManualQuestionSchema).length(7),
  })
  .strict();

/** PATCH /api/questions/[id] body — any subset of edits. */
export const PatchQuestionBodySchema = z
  .object({
    prompt: z.string().trim().min(8).max(400).optional(),
    options: QuestionOptionsTupleSchema.optional(),
    correctIndex: CorrectIndexSchema.optional(),
    difficulty: z.number().int().min(1).max(7).optional(),
    factBlurb: z.string().trim().min(1).max(280).optional(),
    /** Host-placed slot on the board. `null` clears any host override
     *  (lock-time auto-assign refills it). When another question in the
     *  same category already holds that slot — picked or not — the PATCH
     *  performs an atomic swap via the swap_point_value RPC. */
    pointValue: z
      .union([
        z.literal(100),
        z.literal(200),
        z.literal(300),
        z.literal(400),
        z.literal(500),
        z.literal(600),
        z.literal(700),
        z.null(),
      ])
      .optional(),
    /** Persists the host's in-progress pick selection so it survives a
     *  page refresh. The full lock (POST /api/categories/[id]/pick) is
     *  still required to finalise the 7-pick set and mark the category
     *  ready — this just prevents data loss between sessions. */
    isPicked: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.prompt !== undefined ||
      body.options !== undefined ||
      body.correctIndex !== undefined ||
      body.difficulty !== undefined ||
      body.factBlurb !== undefined ||
      body.pointValue !== undefined ||
      body.isPicked !== undefined,
    { message: "PATCH body must include at least one field to update" },
  );

/**
 * PATCH /api/questions/[id]/photo body.
 *
 * Two shapes accepted:
 *   { url, attribution, source }  → swap to a known photo
 *   {}                            → clear the current photo
 */
export const PatchQuestionPhotoBodySchema = z
  .object({
    url: z.string().url().max(2_000).optional(),
    attribution: z.string().trim().max(200).optional(),
    source: z.enum(["pexels", "upload"]).optional(),
  })
  .strict()
  .refine(
    (body) =>
      body.url !== undefined ||
      (body.attribution === undefined && body.source === undefined),
    {
      message: "to clear the image send `{}`; to set it, include `url`",
    },
  );

export type CreateNightInput = z.infer<typeof CreateNightSchema>;
export type CreatePlayerInput = z.infer<typeof CreatePlayerSchema>;
export type HostAddPlayerInput = z.infer<typeof HostAddPlayerSchema>;
export type HeartbeatInput = z.infer<typeof HeartbeatSchema>;
export type JoinGameInput = z.infer<typeof JoinGameSchema>;
export type RevealInput = z.infer<typeof RevealSchema>;
export type EndEarlyInput = z.infer<typeof EndEarlySchema>;
export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;
export type AdjustmentInput = z.infer<typeof AdjustmentSchema>;
export type TopicSuggestionInput = z.infer<typeof TopicSuggestionSchema>;
export type CreateCategoryInput = z.infer<typeof CreateCategoryBodySchema>;
export type PatchCategoryInput = z.infer<typeof PatchCategoryBodySchema>;
export type GenerateCategoryInput = z.infer<typeof GenerateCategoryBodySchema>;
export type PickCategoryInput = z.infer<typeof PickCategoryBodySchema>;
export type ReorderBoardInput = z.infer<typeof ReorderBoardBodySchema>;
export type ManualCategoryInput = z.infer<typeof ManualCategoryBodySchema>;
export type PatchQuestionInput = z.infer<typeof PatchQuestionBodySchema>;
export type PatchQuestionPhotoInput = z.infer<typeof PatchQuestionPhotoBodySchema>;
