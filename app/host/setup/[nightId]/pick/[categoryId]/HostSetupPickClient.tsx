// Client wrapper for the pick screen. Three big jobs:
//
//   1. Subscribe to `category:{id}` broadcasts during generation. As each
//      `question_added` or `photo_attached` event arrives we patch the
//      local questions list so HostGenLoading reflects the live progress.
//      When we receive `done`, we flip to the review state and load the
//      questions from Postgres to get the final canonical rows.
//
//   2. In review, render HostGenPick. The host clicks rows to toggle them
//      into the 7-slot board, with Edit / Swap-image / Regenerate hooks.
//
//   3. Three overlay panels — Edit, Image Swap, Image Upload — slide over
//      the pick workspace. Each is its own modal-style page rendered
//      conditionally above the workspace.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  HostGenLoading,
  HostGenPick,
  HostGenEdit,
  HostGenError,
  HostGenImageSwap,
  HostGenImageUpload,
  type DifficultyTarget,
  type HostGenEditValues,
  type HostGenLoadingQuestion,
  type HostGenPickQuestion,
  type HostGenPhotoCandidate,
} from "@/components/host/gen";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { QuestionRow, CategoryRow } from "@/lib/supabase/types";
import { useGenerationStatus } from "@/lib/hooks/useGenerationStatus";
import type { GenerationPhase } from "@/lib/api/broadcast";
import {
  deriveInitialGenerationMessage,
  explainGenerationFailure,
} from "@/lib/host/generationFailureMessages";
import { mergePickedAfterRefetch } from "@/lib/host/mergePickedAfterRefetch";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostSetupPickClientProps {
  nightId: string;
  categoryId: string;
  categoryName: string;
  categoryTopic: string;
  initialState: CategoryRow["state"];
  initialQuestions: QuestionRow[];
  themeKey: string;
}

type ModalState =
  | { kind: "none" }
  | { kind: "edit"; questionId: string }
  | { kind: "swap"; questionId: string }
  | { kind: "upload"; questionId: string };

export function HostSetupPickClient({
  nightId,
  categoryId,
  categoryName: initialCategoryName,
  categoryTopic,
  initialState,
  initialQuestions,
  themeKey,
}: HostSetupPickClientProps) {
  const router = useRouter();
  const [questions, setQuestions] = useState<QuestionRow[]>(initialQuestions);
  const [state, setState] = useState<CategoryRow["state"]>(initialState);
  // Local mirror of the category's display label so the inline rename
  // can update the header + modal eyebrows without a hard reload. The
  // server is the source of truth on refresh.
  const [categoryName, setCategoryName] = useState(initialCategoryName);
  const [renaming, setRenaming] = useState(false);
  const [pickedIds, setPickedIds] = useState<Set<string>>(
    () => new Set(initialQuestions.filter((q) => q.is_picked).map((q) => q.id)),
  );
  // True while a regenerate ("↻ Another 20") is in flight, even though the
  // category is technically in 'generating' state on the server. We stay
  // on the pick view so the host can see her existing picks survive the
  // refetch — without this flag the page would swap to HostGenLoading.
  const [regenerating, setRegenerating] = useState(false);
  // The Realtime broadcast handler is registered once in a useEffect that
  // closes over `regenerating`. Mirror the value in a ref so the handler
  // can read the current state without re-subscribing on every flip.
  const regeneratingRef = useRef(false);
  useEffect(() => {
    regeneratingRef.current = regenerating;
  }, [regenerating]);
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [difficulty, setDifficulty] = useState<DifficultyTarget>("normal");
  const [flavor, setFlavor] = useState<string[]>([]);
  const [locking, setLocking] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [uploadState, setUploadState] = useState<"idle" | "uploading">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [photoCandidates, setPhotoCandidates] = useState<HostGenPhotoCandidate[]>([]);
  const [photoLookupError, setPhotoLookupError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Last sign of life from the background job — a `progress` heartbeat or an
  // inserted/updated question. Feeds useGenerationStatus so the safety timer is
  // measured from real activity (the write+verify run legitimately takes
  // minutes) instead of from a fixed 60s after start, which false-alarmed.
  const [lastActivityAt, setLastActivityAt] = useState<number>(() => Date.now());
  // Current job phase, surfaced as a live status line on the loading screen.
  const [genPhase, setGenPhase] = useState<GenerationPhase | null>(null);
  // Seed the failure message from the server-rendered state so a refresh
  // into a rolled-back category surfaces the retry / manual-entry UI
  // instead of stranding on the loading spinner. Without this seed the
  // broadcast that fired before the browser subscribed is lost forever.
  const [generationFailureMessage, setGenerationFailureMessage] = useState<
    string | null
  >(() =>
    deriveInitialGenerationMessage({
      initialState,
      initialQuestionCount: initialQuestions.length,
    }),
  );
  const [retrying, setRetrying] = useState(false);

  // ── live subscription ────────────────────────────────────────────────
  useEffect(() => {
    const supa = getSupabaseBrowser();
    let cancelled = false;
    const channel = supa
      .channel(`category:${categoryId}`)
      .on("broadcast", { event: "progress" }, (msg) => {
        if (cancelled) return;
        // Heartbeat while writing / fact-checking, before any row exists.
        // Records activity (keeps the safety timer armed) and drives the live
        // status line so the longer run never looks frozen or "timed out".
        const payload = msg.payload as { phase?: GenerationPhase };
        setLastActivityAt(Date.now());
        if (payload.phase) setGenPhase(payload.phase);
      })
      .on("broadcast", { event: "question_added" }, () => {
        if (cancelled) return;
        setLastActivityAt(Date.now());
        // Refetch the question list to absorb the new row.
        void refetchQuestions();
      })
      .on("broadcast", { event: "photo_attached" }, (msg) => {
        if (cancelled) return;
        setLastActivityAt(Date.now());
        const payload = msg.payload as { questionId?: string; imageUrl?: string };
        if (!payload.questionId) return;
        setQuestions((prev) =>
          prev.map((q) =>
            q.id === payload.questionId
              ? { ...q, image_url: payload.imageUrl ?? q.image_url }
              : q,
          ),
        );
      })
      .on("broadcast", { event: "done" }, () => {
        if (cancelled) return;
        setGenPhase(null);
        setState("review");
        setRegenerating(false);
        void refetchQuestions();
      })
      .on("broadcast", { event: "error" }, (msg) => {
        if (cancelled) return;
        const payload = msg.payload as { error?: string };
        const wasInPlaceRegenerate = regeneratingRef.current;
        if (wasInPlaceRegenerate) {
          // Regenerate failed but we already have 20 candidates from the
          // previous run. Surface a transient toast and let the host
          // continue picking from what she already has — flipping to the
          // full failure UI would lose her workspace for no good reason.
          setError(
            payload.error
              ? `Couldn't fetch another 20: ${payload.error}`
              : "Couldn't fetch another 20. Try again or keep picking from what's here.",
          );
          setRegenerating(false);
          // The server rolled the category back to 'draft'; bump it back
          // to 'review' locally so the pick view stays mounted. The next
          // refresh re-reads from the DB and will sync correctly.
          setState("review");
          return;
        }
        // First-time generation failed — show the persistent failure UI.
        setGenerationFailureMessage(
          explainGenerationFailure({
            broadcastMessage: payload.error ?? null,
            fromTimeout: false,
            fromRollback: true,
          }),
        );
        setState("draft");
        setRegenerating(false);
      })
      .subscribe();
    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const refetchQuestions = useCallback(async () => {
    // Query Supabase directly via the browser client (RLS allows the host
    // to read questions under their own category).
    const supa = getSupabaseBrowser();
    const { data } = await supa.from("questions").select("*").eq("category_id", categoryId);
    if (data) {
      const rows = data as QuestionRow[];
      setQuestions(rows);
      // Picks live in client state until lock — never overwrite the host's
      // selections with what's in the DB. The merge keeps every client
      // pick whose row still exists, unions any DB-confirmed is_picked
      // rows, and drops orphans. See lib/host/mergePickedAfterRefetch.
      // The previous "blindly replace from DB" version silently wiped the
      // host's in-progress picks every time `question_added` fired during
      // an "↻ Another 20" — that was bug A.
      setPickedIds((prev) => mergePickedAfterRefetch(prev, rows));
    }
  }, [categoryId]);

  // Re-fetch on mount when we're already in review (covers reload during pick).
  useEffect(() => {
    if (initialState === "generating") {
      // Nothing to do — wait for the channel to fire.
    } else {
      void refetchQuestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── safety net: timeout + DB-polling fallback for the broadcast ──────
  const watchStatus = useGenerationStatus({
    categoryId,
    state,
    loadedCount: questions.length,
    // Idle-based: only fires after this many ms with no heartbeat AND no
    // question landed. The server heartbeats every ~12s while writing/checking,
    // so a healthy slow run stays armed; a dead worker still surfaces.
    lastActivityAt,
    timeoutMs: 45_000,
    pollIntervalMs: 5_000,
  });

  useEffect(() => {
    if (watchStatus.kind === "timeout" && !generationFailureMessage) {
      setGenerationFailureMessage(
        explainGenerationFailure({
          broadcastMessage: null,
          fromTimeout: true,
          fromRollback: false,
        }),
      );
      setState("draft");
    } else if (
      watchStatus.kind === "rolled-back" &&
      !generationFailureMessage
    ) {
      setGenerationFailureMessage(
        explainGenerationFailure({
          broadcastMessage: null,
          fromTimeout: false,
          fromRollback: true,
        }),
      );
      setState("draft");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchStatus.kind]);

  // ── pick toggling ────────────────────────────────────────────────────
  function togglePick(questionId: string) {
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        if (next.size >= 7) return prev; // hard cap at 7
        next.add(questionId);
      }
      return next;
    });
  }

  // ── lock category (POST /api/categories/[id]/pick) ───────────────────
  async function handleLock() {
    if (pickedIds.size !== 7) return;
    setLocking(true);
    setError(null);
    try {
      const res = await fetch(`/api/categories/${categoryId}/pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionIds: Array.from(pickedIds) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not lock the category");
      }
      router.push(`/host/setup/${nightId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not lock the category.");
      setLocking(false);
    }
  }

  // ── regenerate / flavor tweaks ───────────────────────────────────────
  // When the host already has 20 candidates loaded and taps "↻ Another 20",
  // we stay on the pick screen — the server just appends 20 fresh rows to
  // the same category, the broadcast handler refetches, and the picks the
  // host has already made stay highlighted. Without `regenerating` here
  // the state flip to 'generating' would swap the whole screen out for
  // HostGenLoading and the host would lose sight of her picks.
  async function handleRegenerate(input: {
    difficulty: DifficultyTarget;
    flavor: string[];
  }) {
    setDifficulty(input.difficulty);
    setFlavor(input.flavor);
    setError(null);
    const isInPlaceRegenerate = state === "review" || state === "ready";
    if (isInPlaceRegenerate) {
      setRegenerating(true);
    }
    try {
      const res = await fetch(`/api/categories/${categoryId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          difficulty: input.difficulty,
          flavor: input.flavor.length > 0 ? input.flavor : undefined,
          // On an in-place reroll, tell the server which picks to keep so it
          // can swap out the rest and avoid repeats. First-gen sends nothing.
          keptIds: isInPlaceRegenerate ? Array.from(pickedIds) : undefined,
        }),
      });
      if (!res.ok && res.status !== 202 && res.status !== 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not regenerate");
      }
      if (res.status === 202 && !isInPlaceRegenerate) {
        // First-time generation (category was in 'draft') — show the
        // loading screen the way we did before.
        setState("generating");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not regenerate.");
      setRegenerating(false);
    }
  }

  // ── edit (PATCH /api/questions/[id]) ─────────────────────────────────
  // `persistEdit` is the raw save call — shared by the "Save · this
  // question" button AND by the Swap-image hand-off. The latter MUST save
  // first; without it, `HostGenEdit`'s local form state evaporates when
  // the swap modal mounts and the host's text/options/correct-mark/point
  // edits never reach the DB. Returns the updated row on success, null
  // on failure (error already surfaced to the modal).
  async function persistEdit(
    values: HostGenEditValues,
    questionId: string,
  ): Promise<QuestionRow | null> {
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/questions/${questionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: values.prompt,
          options: values.options,
          correctIndex: values.correctIndex,
          pointValue: values.pointValue,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not save edit");
      }
      const { question } = (await res.json()) as { question: QuestionRow };
      setQuestions((prev) => prev.map((q) => (q.id === question.id ? question : q)));
      return question;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      return null;
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleSaveEdit(values: HostGenEditValues) {
    if (modal.kind !== "edit") return;
    const saved = await persistEdit(values, modal.questionId);
    if (saved) setModal({ kind: "none" });
  }

  async function handleSaveEditAndOpenSwap(values: HostGenEditValues) {
    if (modal.kind !== "edit") return;
    const questionId = modal.questionId;
    const saved = await persistEdit(values, questionId);
    if (saved) setModal({ kind: "swap", questionId });
  }

  // ── photo swap (GET /api/questions/[id]/photos + PATCH photo) ───────
  /**
   * Translate a Pexels failure status into a host-actionable inline
   * message. The host doesn't care about HTTP codes — she needs to know
   * "wait a bit and retry" vs "no results — type your own description."
   */
  function explainPhotoLookupFailure(
    rawMessage: string | undefined,
    status: number,
  ) {
    if (status === 503) {
      return "Pexels is being slow right now. Wait a few seconds and try again, or upload your own photo instead.";
    }
    if (status === 401 || status === 403) {
      return "Image search isn't reachable from your account. Upload a photo instead.";
    }
    if (status >= 500 || status === 0) {
      return "Image search hit a hiccup. Retry, or upload your own photo.";
    }
    return rawMessage?.trim()
      ? rawMessage
      : "Couldn't load alternative photos. Try again or upload your own.";
  }

  async function openSwap(questionId: string) {
    setModal({ kind: "swap", questionId });
    setPhotoCandidates([]);
    setPhotoLookupError(null);
    try {
      const res = await fetch(`/api/questions/${questionId}/photos`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setPhotoLookupError(explainPhotoLookupFailure(body.error, res.status));
        return;
      }
      interface PexelsPhoto {
        id: number;
        src?: { large?: string; medium?: string };
        photographer?: string;
      }
      const body = (await res.json()) as { photos?: PexelsPhoto[] };
      const candidates: HostGenPhotoCandidate[] = (body.photos ?? []).map((p) => ({
        id: String(p.id),
        url: p.src?.large ?? p.src?.medium ?? "",
        attribution: p.photographer,
      }));
      if (candidates.length === 0) {
        setPhotoLookupError(
          "Pexels didn't find any matches for this question. Upload your own photo or skip the image.",
        );
        return;
      }
      setPhotoCandidates(candidates);
    } catch (err) {
      setPhotoLookupError(
        explainPhotoLookupFailure(
          err instanceof Error ? err.message : undefined,
          0,
        ),
      );
    }
  }

  async function handleChoosePhoto(candidate: HostGenPhotoCandidate) {
    if (modal.kind !== "swap") return;
    setSavingPhoto(true);
    setError(null);
    try {
      const res = await fetch(`/api/questions/${modal.questionId}/photo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: candidate.url,
          attribution: candidate.attribution,
          source: "pexels",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not swap photo");
      }
      const { question } = (await res.json()) as { question: Partial<QuestionRow> };
      setQuestions((prev) =>
        prev.map((q) => (q.id === modal.questionId ? { ...q, ...question } : q)),
      );
      setModal({ kind: "none" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not swap photo.");
    } finally {
      setSavingPhoto(false);
    }
  }

  // ── photo upload (POST /api/images/upload) ───────────────────────────
  /**
   * Map a server upload error to a host-actionable message. The host
   * doesn't care about Supabase Storage error codes — she cares whether
   * to pick a different file, shrink it, or retry.
   */
  function explainUploadFailure(rawMessage: string | undefined, status: number) {
    const msg = (rawMessage ?? "").toLowerCase();
    if (msg.includes("too large")) {
      return "That file is over 10 MB. Try a smaller export or compress it first.";
    }
    if (msg.includes("supported image") || msg.includes("not a supported")) {
      return "That file isn't a PNG, JPEG, WEBP, or GIF. Pick a different image.";
    }
    if (msg.includes("empty file")) {
      return "That file came through empty. Try saving and uploading again.";
    }
    if (status === 401 || status === 403) {
      return "Your sign-in expired. Refresh the page and try again.";
    }
    if (status === 0 || status >= 500) {
      return "Storage didn't accept the upload. Try again in a moment.";
    }
    return rawMessage?.trim()
      ? rawMessage
      : "The upload didn't go through. Try a different file or retry.";
  }

  async function handleUploadFile(file: File) {
    if (modal.kind !== "upload") return;
    setUploadState("uploading");
    setError(null);
    setUploadError(null);
    // Client-side belt: catch the obvious too-large file BEFORE we burn
    // a round-trip. The server enforces this too.
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(
        "That file is over 10 MB. Try a smaller export or compress it first.",
      );
      setUploadState("idle");
      return;
    }
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("questionId", modal.questionId);
      const res = await fetch("/api/images/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setUploadError(explainUploadFailure(body.error, res.status));
        return;
      }
      const { question } = (await res.json()) as { question: Partial<QuestionRow> };
      setQuestions((prev) =>
        prev.map((q) => (q.id === modal.questionId ? { ...q, ...question } : q)),
      );
      setModal({ kind: "none" });
    } catch (err) {
      // Network-layer failure (fetch rejected). Treat as a transient.
      setUploadError(
        explainUploadFailure(
          err instanceof Error ? err.message : undefined,
          0,
        ),
      );
    } finally {
      setUploadState("idle");
    }
  }

  // ── recovery: retry generation or bail to manual entry ───────────────
  async function handleRetryGeneration() {
    setRetrying(true);
    setGenerationFailureMessage(null);
    try {
      const res = await fetch(`/api/categories/${categoryId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          difficulty,
          flavor: flavor.length > 0 ? flavor : undefined,
        }),
      });
      if (!res.ok && res.status !== 202 && res.status !== 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setGenerationFailureMessage(
          explainGenerationFailure({
            broadcastMessage: body.error ?? null,
            fromTimeout: false,
            fromRollback: true,
          }),
        );
        return;
      }
      if (res.status === 202 || res.status === 409) {
        setState("generating");
      }
    } catch (err) {
      setGenerationFailureMessage(
        explainGenerationFailure({
          broadcastMessage:
            err instanceof Error ? err.message : null,
          fromTimeout: false,
          fromRollback: true,
        }),
      );
    } finally {
      setRetrying(false);
    }
  }

  function handleEnterManually() {
    router.push(
      `/host/setup/${nightId}/pick/${categoryId}/manual`,
    );
  }

  // ── rename (PATCH /api/categories/[id]) ─────────────────────────────
  // Renaming is allowed in any state — draft, generating, review, ready.
  // The mutation only touches `categories.name`; `categories.topic` (the
  // original Claude prompt) is preserved server-side.
  const handleRename = useCallback(
    async (next: string): Promise<void> => {
      setRenaming(true);
      setError(null);
      try {
        const res = await fetch(`/api/categories/${categoryId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "could not rename category");
        }
        const { category } = (await res.json()) as {
          category: { id: string; name: string };
        };
        setCategoryName(category.name);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not rename.";
        setError(msg);
        // Re-throw so the inline editor knows the commit failed and can
        // keep the input open + restore focus with the unsaved value.
        throw err;
      } finally {
        setRenaming(false);
      }
    },
    [categoryId],
  );

  const showGenerationFailure =
    generationFailureMessage !== null && state !== "review" && state !== "ready";

  // ── mapped data for the components ───────────────────────────────────
  const loadingList = useMemo<HostGenLoadingQuestion[]>(
    () =>
      questions
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((q) => ({
          id: q.id,
          prompt: q.prompt,
          difficulty: q.difficulty,
          imageUrl: q.image_url,
        })),
    [questions],
  );
  const pickList = useMemo<HostGenPickQuestion[]>(
    () =>
      questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correct_index,
        difficulty: q.difficulty,
        // Surfaces any host-set point_value (from the Edit panel's
        // POINT VALUE picker) so YOUR BOARD respects it.
        pointValue: q.point_value,
        edited: q.source === "host-edit",
        imageUrl: q.image_url,
      })),
    [questions],
  );

  const editingQuestion =
    modal.kind === "edit" ? questions.find((q) => q.id === modal.questionId) ?? null : null;
  const swapQuestion =
    modal.kind === "swap" ? questions.find((q) => q.id === modal.questionId) ?? null : null;
  const uploadQuestion =
    modal.kind === "upload" ? questions.find((q) => q.id === modal.questionId) ?? null : null;

  return (
    <>
      {showGenerationFailure ? (
        <HostGenError
          themeKey={themeKey as ThemeKey}
          shellTitle={`generation didn't work · ${categoryName.toLowerCase()}`}
          topic={categoryName}
          message={generationFailureMessage}
          onRetry={() => void handleRetryGeneration()}
          onEnterManually={handleEnterManually}
          onBack={() => router.push(`/host/setup/${nightId}`)}
          isRetrying={retrying}
        />
      ) : state !== "review" && state !== "ready" && !regenerating ? (
        <HostGenLoading
          themeKey={themeKey as ThemeKey}
          shellTitle={`pulling questions · ${categoryName.toLowerCase()}`}
          topic={categoryName}
          loaded={loadingList}
          total={20}
          statusLine={
            genPhase === "checking"
              ? "Fact-checking every answer for accuracy — this part takes a moment."
              : genPhase === "writing"
                ? "Writing your questions…"
                : undefined
          }
          onCancel={() => router.push(`/host/setup/${nightId}`)}
          onBack={() => router.push(`/host/setup/${nightId}`)}
        />
      ) : (
        <HostGenPick
          themeKey={themeKey as ThemeKey}
          shellTitle={`pick 7 · ${categoryName.toLowerCase()}`}
          topic={categoryName}
          questions={pickList}
          pickedIds={pickedIds}
          difficulty={difficulty}
          flavor={flavor}
          onTogglePick={togglePick}
          onEdit={(id) => setModal({ kind: "edit", questionId: id })}
          onSwapImage={(id) => void openSwap(id)}
          onLock={handleLock}
          onRegenerate={handleRegenerate}
          onRename={handleRename}
          onBack={() => router.push(`/host/setup/${nightId}`)}
          isRenaming={renaming}
          isLocking={locking}
          isRegenerating={regenerating}
        />
      )}

      {editingQuestion && (
        <ModalOverlay onDismiss={() => setModal({ kind: "none" })}>
          <HostGenEdit
            themeKey={themeKey as ThemeKey}
            shellTitle={`edit · ${categoryName.toLowerCase()}`}
            topic={categoryName}
            initial={{
              prompt: editingQuestion.prompt,
              options: editingQuestion.options,
              correctIndex: editingQuestion.correct_index,
              pointValue: editingQuestion.point_value,
            }}
            imageSeed={editingQuestion.image_url ?? categoryTopic}
            onSave={handleSaveEdit}
            onClose={() => setModal({ kind: "none" })}
            onSwapImage={handleSaveEditAndOpenSwap}
            isSaving={savingEdit}
          />
        </ModalOverlay>
      )}
      {swapQuestion && (
        <ModalOverlay onDismiss={() => setModal({ kind: "none" })}>
          <HostGenImageSwap
            themeKey={themeKey as ThemeKey}
            shellTitle={`image · ${categoryName.toLowerCase()}`}
            topic={categoryName}
            prompt={swapQuestion.prompt}
            pointValue={swapQuestion.point_value ?? swapQuestion.difficulty * 100}
            currentImageUrl={swapQuestion.image_url}
            candidates={photoCandidates}
            onChoose={handleChoosePhoto}
            onOpenUpload={() => {
              setUploadError(null);
              setModal({ kind: "upload", questionId: swapQuestion.id });
            }}
            onLoadMore={() => void openSwap(swapQuestion.id)}
            onBack={() => setModal({ kind: "none" })}
            isSaving={savingPhoto}
            errorMessage={photoLookupError}
            onErrorRetry={() => void openSwap(swapQuestion.id)}
          />
        </ModalOverlay>
      )}
      {uploadQuestion && (
        <ModalOverlay onDismiss={() => setModal({ kind: "none" })}>
          <HostGenImageUpload
            themeKey={themeKey as ThemeKey}
            shellTitle={`upload · ${categoryName.toLowerCase()}`}
            topic={categoryName}
            prompt={uploadQuestion.prompt}
            state={uploadState}
            onFileChosen={(file) => void handleUploadFile(file)}
            onBack={() => {
              setUploadError(null);
              setModal({ kind: "swap", questionId: uploadQuestion.id });
            }}
            errorMessage={uploadError}
            onErrorRetry={() => setUploadError(null)}
          />
        </ModalOverlay>
      )}

      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 60,
            padding: "12px 16px",
            borderRadius: 10,
            background: "rgba(156,47,47,.95)",
            color: "#FFF",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              background: "transparent",
              color: "#FFF",
              border: "1px solid rgba(255,255,255,.4)",
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}

function ModalOverlay({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 1400,
          maxHeight: "90vh",
          background: "var(--paper)",
          borderRadius: 16,
          overflow: "auto",
          boxShadow: "0 40px 80px -20px rgba(0,0,0,.6)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
