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
//      the spinner for over a minute with nothing landing.
//
// This hook layers a simple safety net on top of the broadcast:
//   * After `timeoutMs` (default 60s) with the category still in
//     'generating' AND zero questions landed → flip to 'timeout'.
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

export type GenerationStatus =
  | { kind: "ok" }
  | { kind: "timeout" }
  | { kind: "rolled-back" };

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
  /** Override the safety timeout. Default 60 000ms. */
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
  timeoutMs = 60_000,
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
      const since = Date.now() - (startedAtRef.current ?? Date.now());

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
          // The job finished but we missed the broadcast. Surface 'ok'
          // so the parent's broadcast handler / refetch fires.
          setStatus({ kind: "ok" });
          return;
        }
      } catch {
        // Best-effort. A network blip here doesn't escalate to a failure
        // banner on its own — the timeout below will catch it.
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
  }, [categoryId, state, loadedCount, timeoutMs, pollIntervalMs, disabled]);

  return status;
}
