// Polling + timeout fallback for the Claude question-generation job.
//
// The category generation runs as a background job via `after()` and
// broadcasts progress on `category:{id}`. That channel is the happy
// path. Two ways it can leave the host's UI stuck on a spinner:
//
//   1. The job throws but the `error` broadcast never lands (e.g. the
//      ack itself failed, or the worker died mid-flight).
//   2. Anthropic is very slow / a deploy interrupted the worker, so the
//      job is technically still alive but the host has been staring at
//      the spinner with no heartbeat and nothing landing.
//
// This hook layers a simple safety net on top of the broadcast:
//   * After `timeoutMs` of IDLE (no heartbeat and no question landed) with the
//     category still in 'generating' AND zero questions landed → flip to
//     'timeout'. The clock is measured from the last sign of life
//     (`lastActivityAt`), NOT from when generation started — the server now
//     emits `progress` heartbeats while it writes and fact-checks (a run that
//     legitimately takes minutes), so a healthy-but-slow job keeps the timer
//     armed and never false-alarms; only a genuinely silent worker trips it.
//   * Every `pollIntervalMs` (default 5s) re-check the category state
//     via Supabase directly. If the DB says state='review' or 'ready'
//     we surface that. If state='draft' (the generation job rolled it
//     back) we surface that as an implicit error.
//
// The hook is pure / side-effect-free outside of its own timers; the
// parent decides what to do with the resulting status.

"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { CategoryRow } from "@/lib/supabase/types";
import {
  generationProgressFromRow,
  readGenerationJob,
  type GenerationJobClient,
  type GenerationJobProgress,
} from "@/lib/ai/generation-job";

export type GenerationStatus =
  | { kind: "ok" }
  | { kind: "timeout" }
  | { kind: "rolled-back" }
  | { kind: "progress"; progress: GenerationJobProgress }
  | { kind: "needs-attention"; progress: GenerationJobProgress }
  | { kind: "completed"; state: "review" | "ready" };

// The route can legitimately run for up to 300 seconds. Only call the worker
// dead after that server-side ceiling plus a small finalization/polling margin.
export const GENERATION_STALL_TIMEOUT_MS = 330_000;

export interface UseGenerationStatusOptions {
  /** The category we're watching. Stop watching when null. */
  categoryId: string | null;
  /**
   * The current state per the parent (driven by the broadcast). When
   * 'review' or 'ready' the hook does nothing — generation completed.
   */
  state: CategoryRow["state"];
  /** Number of question rows the parent currently has loaded. */
  loadedCount: number;
  /**
   * Timestamp (ms, e.g. `Date.now()`) of the most recent sign of life from the
   * job — a `progress` heartbeat or an inserted question. The idle timeout is
   * measured from `max(window start, this)`, so a slow run that keeps
   * heartbeating never false-alarms and a stale value can never shorten the
   * window. Omit/0 → measured from window start.
   */
  lastActivityAt?: number;
  /** Override the idle safety timeout. Defaults beyond the route's 300s ceiling. */
  timeoutMs?: number;
  /** Override the polling interval. Default 5 000ms. */
  pollIntervalMs?: number;
  /** Disable the hook entirely (useful in tests / SSR). */
  disabled?: boolean;
}

export function useGenerationStatus({
  categoryId,
  state,
  loadedCount,
  lastActivityAt,
  timeoutMs = GENERATION_STALL_TIMEOUT_MS,
  pollIntervalMs = 5_000,
  disabled = false,
}: UseGenerationStatusOptions): GenerationStatus {
  const [status, setStatus] = useState<GenerationStatus>({ kind: "ok" });
  // We track when the current "generating" window started so the
  // timeout resets cleanly across regenerate cycles.
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (disabled || !categoryId) {
      setStatus({ kind: "ok" });
      startedAtRef.current = null;
      return;
    }
    if (state !== "generating") {
      // The job finished (review/ready) or got rolled back to draft.
      // Reset our internal status — the parent owns the UI now.
      setStatus({ kind: "ok" });
      startedAtRef.current = null;
      return;
    }

    // Generating: start (or continue) the timeout window.
    if (startedAtRef.current == null) {
      startedAtRef.current = Date.now();
    }

    let cancelled = false;
    const supa = getSupabaseBrowser();

    const tick = async () => {
      if (cancelled) return;
      // Idle time = now minus the latest sign of life. A heartbeat or an
      // inserted question (lastActivityAt) keeps this small; only true silence
      // lets it grow past timeoutMs. Falls back to the window start when no
      // activity has arrived yet.
      const lastSignal = Math.max(
        startedAtRef.current ?? Date.now(),
        lastActivityAt ?? 0,
      );
      const since = Date.now() - lastSignal;

      // Re-check the category in the DB. The broadcast might've missed
      // landing — the DB is authoritative.
      try {
        const { data } = await supa
          .from("categories")
          .select("state")
          .eq("id", categoryId)
          .maybeSingle();
        if (cancelled) return;
        const row = (data ?? null) as { state?: string } | null;
        const dbState = (row?.state ?? null) as
          | CategoryRow["state"]
          | null;
        if (dbState === "draft") {
          // The job rolled the category back. That means it errored out.
          setStatus({ kind: "rolled-back" });
          return;
        }
        if (dbState === "review" || dbState === "ready") {
          // The job finished but we missed the broadcast. Tell the parent to
          // refetch durable rows and leave the loading screen.
          setStatus({ kind: "completed", state: dbState });
          return;
        }
      } catch {
        // Best-effort. A network blip here doesn't escalate to a failure
        // banner on its own — the timeout below will catch it.
      }

      // Durable progress is the host-facing truth. It survives reloads,
      // missed broadcasts, browser changes, and interrupted server workers.
      try {
        const job = await readGenerationJob(
          supa as unknown as GenerationJobClient,
          categoryId,
        );
        if (cancelled) return;
        if (job) {
          const progress = generationProgressFromRow(job);
          if (progress.phase === "needs_attention") {
            setStatus({ kind: "needs-attention", progress });
          } else {
            setStatus({ kind: "progress", progress });
          }
          return;
        }
      } catch {
        // Older environments may not have the additive progress table yet.
        // Preserve the existing category-state and idle-timeout fallback.
      }

      if (since >= timeoutMs && loadedCount === 0) {
        // Past the safety window with nothing landed. Treat as failure.
        setStatus({ kind: "timeout" });
        return;
      }
    };

    // Run an immediate check so a freshly rolled-back state surfaces
    // without waiting a full interval.
    void tick();

    const interval = window.setInterval(() => {
      void tick();
    }, pollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [categoryId, state, loadedCount, lastActivityAt, timeoutMs, pollIntervalMs, disabled]);

  return status;
}
