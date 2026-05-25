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

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  deriveInitialGenerationMessage,
  explainGenerationFailure,
} from "@/lib/host/generationFailureMessages";
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
  categoryName,
  categoryTopic,
  initialState,
  initialQuestions,
  themeKey,
}: HostSetupPickClientProps) {
  const router = useRouter();
  const [questions, setQuestions] = useState<QuestionRow[]>(initialQuestions);
  const [state, setState] = useState<CategoryRow["state"]>(initialState);
  const [pickedIds, setPickedIds] = useState<Set<string>>(
    () => new Set(initialQuestions.filter((q) => q.is_picked).map((q) => q.id)),
  );
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
      .on("broadcast", { event: "question_added" }, () => {
        if (cancelled) return;
        // Refetch the question list to absorb the new row.
        void refetchQuestions();
      })
      .on("broadcast", { event: "photo_attached" }, (msg) => {
        if (cancelled) return;
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
        setState("review");
        void refetchQuestions();
      })
      .on("broadcast", { event: "error" }, (msg) => {
        if (cancelled) return;
        const payload = msg.payload as { error?: string };
        // Keep the generation-failure UI persistent; the toast banner
        // is for transient errors (edit/lock/upload) only.
        setGenerationFailureMessage(
          explainGenerationFailure({
            broadcastMessage: payload.error ?? null,
            fromTimeout: false,
            fromRollback: true,
          }),
        );
        setState("draft");
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
      setPickedIds(new Set(rows.filter((q) => q.is_picked).map((q) => q.id)));
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
    timeoutMs: 60_000,
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
  async function handleRegenerate(input: {
    difficulty: DifficultyTarget;
    flavor: string[];
  }) {
    setDifficulty(input.difficulty);
    setFlavor(input.flavor);
    setError(null);
    try {
      const res = await fetch(`/api/categories/${categoryId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          difficulty: input.difficulty,
          flavor: input.flavor.length > 0 ? input.flavor : undefined,
        }),
      });
      if (!res.ok && res.status !== 202 && res.status !== 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not regenerate");
      }
      if (res.status === 202) {
        setState("generating");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not regenerate.");
    }
  }

  // ── edit (PATCH /api/questions/[id]) ─────────────────────────────────
  async function handleSaveEdit(values: HostGenEditValues) {
    if (modal.kind !== "edit") return;
    setSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/questions/${modal.questionId}`, {
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
      setModal({ kind: "none" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSavingEdit(false);
    }
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
      ) : state !== "review" && state !== "ready" ? (
        <HostGenLoading
          themeKey={themeKey as ThemeKey}
          shellTitle={`pulling questions · ${categoryName.toLowerCase()}`}
          topic={categoryName}
          loaded={loadingList}
          total={20}
          onCancel={() => router.push(`/host/setup/${nightId}`)}
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
          isLocking={locking}
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
            onSwapImage={() => setModal({ kind: "swap", questionId: editingQuestion.id })}
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
