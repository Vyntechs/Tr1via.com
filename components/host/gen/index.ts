// Barrel export for the host's question-generation flow. The 9 screens
// follow Linda's actual loop, in workflow order:
//
//   1. Overview        — both games at a glance
//   2. TopicEntry      — typing a topic, repeat warning, flavor settings
//   3. Loading         — pulling 20 questions (split progress: text + photo)
//   4. Pick            — choose 7 of 20 with the board building in the sidebar
//   5. Edit            — inline panel to edit one question
//   6. ImageSwap       — 12 alternative photos from the library
//   6b. ImageUpload    — drag-and-drop / paste URL upload zone
//   6c. ImageUploadReady — uploaded photo, crop + use
//   7. Flavor          — "Sharper" applied, picks kept, others dissolving
//   8. Launch          — both boards ready, room about to open

export { HostGenOverview } from "./HostGenOverview";
export type {
  HostGenOverviewProps,
  CategorySlotData,
  GameOverviewData,
} from "./HostGenOverview";

export { HostGenTopicEntry } from "./HostGenTopicEntry";
export type {
  HostGenTopicEntryProps,
  DifficultyTarget,
  RecentTopic,
} from "./HostGenTopicEntry";

export { HostGenLoading } from "./HostGenLoading";
export type { HostGenLoadingProps, HostGenLoadingQuestion } from "./HostGenLoading";

export { HostGenPick } from "./HostGenPick";
export type { HostGenPickProps, HostGenPickQuestion } from "./HostGenPick";

export { HostGenAuditSummary } from "./HostGenAuditSummary";
export type { HostGenAuditSummaryProps } from "./HostGenAuditSummary";

export { HostGenEdit } from "./HostGenEdit";
export type { HostGenEditProps, HostGenEditValues } from "./HostGenEdit";

export { HostGenImageSwap } from "./HostGenImageSwap";
export type { HostGenImageSwapProps, HostGenPhotoCandidate } from "./HostGenImageSwap";

export { HostGenImageUpload } from "./HostGenImageUpload";
export type { HostGenImageUploadProps, HostGenImageUploadState } from "./HostGenImageUpload";

export { HostGenImageUploadReady } from "./HostGenImageUploadReady";
export type { HostGenImageUploadReadyProps } from "./HostGenImageUploadReady";

export { HostGenFlavor } from "./HostGenFlavor";
export type { HostGenFlavorProps } from "./HostGenFlavor";

export { HostGenLaunch } from "./HostGenLaunch";
export type { HostGenLaunchProps } from "./HostGenLaunch";

export { HostGenError } from "./HostGenError";
export type { HostGenErrorProps } from "./HostGenError";

export { HostGenManualEntry } from "./HostGenManualEntry";
export type {
  HostGenManualEntryProps,
  HostGenManualQuestionInput,
} from "./HostGenManualEntry";
