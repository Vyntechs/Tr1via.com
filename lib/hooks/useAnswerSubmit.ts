// useAnswerSubmit — optimistic POST /api/answers that keeps trying until the
// question closes.
//
// State machine:
//   idle     → submit(slot)          → pending     (the choice is held at once)
//   pending  → 2xx or 409            → sent        (terminal for this question)
//   pending  → 5xx / network / slow  → retrying    (keeps going; backoff, no cap)
//   retrying → 2xx or 409            → sent
//   *        → other 4xx             → failed      (reason "rejected": usually a bug)
//   *        → the answer window ends→ failed      (reason "closed": never confirmed)
//   failed   → retry()               → pending     (manual re-attempt from the UI)
//
// "Slow" = no reply within attemptTimeoutMs (default 6 s). A slow request is
// NOT cancelled: on a bad venue connection it may still land, and cancelling it
// would restart the clock forever. The next attempt starts alongside it, at most
// MAX_IN_FLIGHT at once, and the first confirmation wins. The server is
// idempotent per (question, player), so duplicates answer 409 = success.
// What the server accepts, and when it stops accepting, is decided server-side:
// the phone only stops sending once its own timer has ended.
//
// "sent" is decided by the send response itself (204/200/409), not by a second
// room fetch, so the phone can say "Locked in" as soon as the server says so.
//
// Refresh-survives-the-answer: on submit we persist {questionId, slotChosen}
// to localStorage. If the page unmounts mid-retry (player refreshes or closes
// Safari and reopens), the next mount on the same questionId reads it and
// re-fires the submit. Cleared on `sent`. The server is idempotent via the
// unique (question_id, player_id) constraint + 409 handling, so a double-fire
// is safe.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { diagActive, diagEvent } from "@/lib/diagnostics/client";

export type AnswerSubmitStatus = "idle" | "pending" | "retrying" | "sent" | "failed";
/** Why a `failed` status happened. `closed` = the window ended before the
 *  server confirmed; `rejected` = the server refused the answer (or an explicit
 *  maxAttempts ran out). */
export type AnswerSubmitFailure = "closed" | "rejected";

export interface UseAnswerSubmitOptions {
  questionId: string;
  scramble: number[];
  /** False once the authoritative player timer reaches zero. */
  accepting?: boolean;
  /**
   * True once the signed room snapshot already carries this player's answer
   * for this question. Stops any resend: the server has it.
   */
  serverHasAnswer?: boolean;
  /** Default Infinity (keep trying until the question closes). */
  maxAttempts?: number;
  /** Default [500, 1000, 2000] (ms between attempts; the last value repeats). */
  backoffMs?: number[];
  /** A request with no reply after this long counts as "didn't go through". Default 6000. */
  attemptTimeoutMs?: number;
}

export interface UseAnswerSubmitResult {
  status: AnswerSubmitStatus;
  /** Lock + send the chosen slot (1..4). Idempotent — no-op if pending/retrying/sent. */
  submit: (slot: 1 | 2 | 3 | 4) => void;
  /** Re-attempt after a failed terminal. No-op if not failed. */
  retry: () => void;
  /**
   * Timestamp (Date.now()) set the moment the server confirms the answer.
   * null until then. Task 15 uses this to fire the lock-in ceremony only after
   * the DB has the answer — not on the tap itself.
   */
  confirmedAt: number | null;
  /** The slot (1..4) tapped or resumed on this device; null before any tap. */
  chosenSlot: 1 | 2 | 3 | 4 | null;
  /** Set while status is `failed`. */
  failure: AnswerSubmitFailure | null;
}

const DEFAULT_BACKOFF = [500, 1000, 2000];
export const ANSWER_ATTEMPT_TIMEOUT_MS = 6000;
const MAX_IN_FLIGHT = 3;

export const PENDING_ANSWER_KEY = "tr1via:pending-answer";

export interface PendingAnswer {
  questionId: string;
  slotChosen: 1 | 2 | 3 | 4;
}

export function loadPendingAnswer(): PendingAnswer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_ANSWER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (
      !p ||
      typeof p !== "object" ||
      typeof (p as { questionId?: unknown }).questionId !== "string" ||
      ![1, 2, 3, 4].includes((p as { slotChosen?: unknown }).slotChosen as number)
    ) {
      return null;
    }
    const obj = p as { questionId: string; slotChosen: number };
    return { questionId: obj.questionId, slotChosen: obj.slotChosen as 1 | 2 | 3 | 4 };
  } catch {
    return null;
  }
}

function savePendingAnswer(p: PendingAnswer): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_ANSWER_KEY, JSON.stringify(p));
  } catch {
    // Storage full or disabled (private browsing on some browsers) — best-effort.
  }
}

export function clearPendingAnswer(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_ANSWER_KEY);
  } catch {
    // Ignore — storage layer is best-effort.
  }
}

function isTerminalClientError(status: number): boolean {
  // 4xx that we won't retry. 409 is "already answered" which is success-equivalent.
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}

type Verdict = "sent" | "retry" | "rejected";

/** The newer answer engine replies 200 with a result code in the body. Only
 *  "confirmed" (or no code at all) means the answer counted. */
async function readBody(res: Response): Promise<{ code?: unknown; error?: unknown } | null> {
  try {
    return JSON.parse(await res.text()) as { code?: unknown; error?: unknown } | null;
  } catch {
    return null;
  }
}

async function readResultCode(res: Response): Promise<string | null> {
  const body = await readBody(res);
  return typeof body?.code === "string" ? body.code : null;
}

async function judgeResponse(res: Response): Promise<Verdict> {
  if (res.status === 204) return "sent";
  if (res.status === 409) {
    // 409 is "already answered" (the server has it: success) but the same
    // status also means "question is not live" and the like. Only the first
    // may say "Locked in"; a bare 409 with no reason is the duplicate case.
    const reason = (await readBody(res))?.error;
    if (reason === undefined || reason === null || reason === "") return "sent";
    return typeof reason === "string" && /already answered/i.test(reason) ? "sent" : "rejected";
  }
  if (res.status >= 200 && res.status < 300) {
    const code = await readResultCode(res);
    if (code === null || code === "confirmed") return "sent";
    return code === "retry_later" ? "retry" : "rejected";
  }
  return isTerminalClientError(res.status) ? "rejected" : "retry";
}

export function useAnswerSubmit({
  questionId,
  scramble,
  accepting = true,
  serverHasAnswer = false,
  maxAttempts = Number.POSITIVE_INFINITY,
  backoffMs = DEFAULT_BACKOFF,
  attemptTimeoutMs = ANSWER_ATTEMPT_TIMEOUT_MS,
}: UseAnswerSubmitOptions): UseAnswerSubmitResult {
  const [status, setStatus] = useState<AnswerSubmitStatus>("idle");
  const [confirmedAt, setConfirmedAt] = useState<number | null>(null);
  const [chosenSlot, setChosenSlot] = useState<1 | 2 | 3 | 4 | null>(null);
  const [failure, setFailure] = useState<AnswerSubmitFailure | null>(null);
  const lastSlotRef = useRef<1 | 2 | 3 | 4 | null>(null);
  // Bumped whenever the question changes or the hook unmounts. Every request,
  // timer and reply carries the number it started under and is ignored if it
  // no longer matches, so an old question's send can never mark a new one sent.
  const genRef = useRef(0);
  // An answer is being sent, or was confirmed. Set synchronously on the tap so
  // a second tap in the same frame can never start a second send.
  const busyRef = useRef(false);
  const sentRef = useRef(false);
  const inFlightRef = useRef<Set<AbortController>>(new Set());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acceptingRef = useRef(accepting);
  acceptingRef.current = accepting;
  const serverHasAnswerRef = useRef(serverHasAnswer);
  const optsRef = useRef({ scramble, maxAttempts, backoffMs, attemptTimeoutMs });
  // Latest options for the timers and replies that outlive a render. Declared
  // before the effects below so it is current when they run.
  useEffect(() => {
    serverHasAnswerRef.current = serverHasAnswer;
    optsRef.current = { scramble, maxAttempts, backoffMs, attemptTimeoutMs };
  });
  // Diagnostic log only: when this tap happened on the phone's own clock and
  // what the server last said. Never read by the answer logic. `resumed` marks
  // an answer re-sent after a refresh: its real tap time is not known, so none
  // is claimed (the server stores "unknown" rather than the resume time).
  const tapLogRef = useRef<{ at: number; last: number | string | null; resumed?: boolean } | null>(null);
  const reportTap = useCallback(
    (slot: number, tries: number, ok: boolean) => {
      const tap = tapLogRef.current;
      if (!tap) return;
      tapLogRef.current = null;
      const ms = Date.now() - tap.at;
      diagEvent(
        "tap",
        { q: questionId, slot, tries, ms, ok, st: tap.last, rs: tap.resumed },
        !ok || tries > 1 || ms > 2000 || tap.resumed === true,
      );
    },
    [questionId],
  );

  const stopAll = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const flying = Array.from(inFlightRef.current);
    inFlightRef.current.clear();
    for (const ctrl of flying) ctrl.abort();
  }, []);

  const settleSent = useCallback(
    (gen: number, slot: number, tries: number) => {
      if (gen !== genRef.current || sentRef.current) return;
      sentRef.current = true;
      busyRef.current = true;
      stopAll();
      reportTap(slot, tries, true);
      clearPendingAnswer();
      setFailure(null);
      setConfirmedAt(Date.now());
      setStatus("sent");
    },
    [reportTap, stopAll],
  );

  const settleFailed = useCallback(
    (gen: number, slot: number, tries: number, reason: AnswerSubmitFailure, keepStoredAnswer: boolean) => {
      if (gen !== genRef.current || sentRef.current) return;
      busyRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      reportTap(slot, tries, false);
      // Out of window or refused: nothing useful to resume later. Out of
      // attempts (explicit maxAttempts): leave it so a refresh can re-fire.
      if (!keepStoredAnswer) clearPendingAnswer();
      setFailure(reason);
      setStatus("failed");
    },
    [reportTap],
  );

  const runAttempt = useCallback(
    (slot: 1 | 2 | 3 | 4, attempt: number) => {
      const gen = genRef.current;
      if (sentRef.current) return;
      if (!acceptingRef.current) {
        settleFailed(gen, slot, attempt, "closed", false);
        return;
      }
      const tries = attempt + 1;
      const flying = inFlightRef.current;
      if (flying.size >= MAX_IN_FLIGHT) {
        const oldest = flying.values().next().value;
        if (oldest) {
          flying.delete(oldest);
          oldest.abort();
        }
      }
      const ctrl = new AbortController();
      flying.add(ctrl);

      // Each attempt hands over to at most one follow-up attempt, whether it
      // failed outright or just went quiet.
      let followed = false;
      let slowTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (slowTimer) clearTimeout(slowTimer);
        flying.delete(ctrl);
      };
      const followUp = (quiet: boolean) => {
        if (followed || gen !== genRef.current || sentRef.current) return;
        if (!acceptingRef.current) {
          followed = true;
          settleFailed(gen, slot, tries, "closed", false);
          return;
        }
        if (tries >= optsRef.current.maxAttempts) {
          // Explicit cap reached. A quiet request may still answer; a failed
          // one will not.
          if (quiet) return;
          followed = true;
          settleFailed(gen, slot, tries, "rejected", true);
          return;
        }
        followed = true;
        setStatus("retrying");
        const { backoffMs: schedule } = optsRef.current;
        const base = schedule[Math.min(attempt, schedule.length - 1)] ?? schedule[schedule.length - 1] ?? 1000;
        // A little spread so a whole room does not retry on the same beat.
        const delay = base > 0 ? Math.round(base * (0.8 + Math.random() * 0.4)) : 0;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (gen === genRef.current) runAttempt(slot, attempt + 1);
        }, delay);
      };

      slowTimer = setTimeout(() => followUp(true), optsRef.current.attemptTimeoutMs);

      void (async () => {
        try {
          const res = await fetch("/api/answers", {
            method: "POST",
            credentials: "same-origin",
            signal: ctrl.signal,
            headers: {
              "Content-Type": "application/json",
              // The phone's own tap timing, for the diagnostic log (headers, so
              // the body the server validates is unchanged).
              ...(diagActive()
                ? {
                    // A resumed answer has no known tap time: leave it out.
                    ...(tapLogRef.current?.resumed
                      ? {}
                      : { "x-tr1via-tap-at": String(tapLogRef.current?.at ?? Date.now()) }),
                    "x-tr1via-sent-at": String(Date.now()),
                    "x-tr1via-attempt": String(attempt),
                  }
                : {}),
            },
            body: JSON.stringify({ questionId, slotChosen: slot, scramble: optsRef.current.scramble }),
          });
          if (tapLogRef.current) tapLogRef.current.last = res.status;
          if (gen !== genRef.current) return finish();
          const verdict = await judgeResponse(res);
          finish();
          if (gen !== genRef.current) return;
          if (verdict === "sent") settleSent(gen, slot, tries);
          else if (verdict === "rejected") settleFailed(gen, slot, tries, "rejected", false);
          else followUp(false);
        } catch {
          finish();
          // Aborted by us (answered elsewhere, question changed): not a failure.
          if (ctrl.signal.aborted || gen !== genRef.current) return;
          if (tapLogRef.current) tapLogRef.current.last = "network";
          followUp(false);
        }
      })();
    },
    [questionId, settleFailed, settleSent],
  );

  useEffect(() => {
    // Reset on question change.
    genRef.current += 1;
    stopAll();
    lastSlotRef.current = null;
    busyRef.current = false;
    sentRef.current = false;
    tapLogRef.current = null;
    setStatus("idle");
    setConfirmedAt(null);
    setChosenSlot(null);
    setFailure(null);

    // Refresh-survives-the-answer: if the player closed/refreshed mid-retry
    // for THIS question, the persisted slot is still in localStorage. Resume
    // the submission. The server is idempotent (409 → treated as sent), so
    // re-firing after a partial first attempt is safe.
    const pending = loadPendingAnswer();
    if (pending) {
      if (pending.questionId === questionId) {
        if (acceptingRef.current && !serverHasAnswerRef.current) {
          busyRef.current = true;
          lastSlotRef.current = pending.slotChosen;
          tapLogRef.current = { at: Date.now(), last: null, resumed: true }; // diagnostic log only
          setChosenSlot(pending.slotChosen);
          setStatus("pending");
          runAttempt(pending.slotChosen, 0);
        } else {
          clearPendingAnswer();
        }
      } else {
        // Stale entry for a different question — clear so it doesn't fire later.
        clearPendingAnswer();
      }
    }

    return () => {
      genRef.current += 1;
      stopAll();
    };
    // runAttempt depends on the same `questionId` that gates this effect, so
    // including it would create a redundant re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  useEffect(() => {
    if (accepting) return;
    const pending = loadPendingAnswer();
    if (pending?.questionId === questionId) clearPendingAnswer();
    // The window just ended. If nothing is in flight, nothing more can be
    // sent: say so now. If a request is still out, it may yet land; its
    // reply (or its quiet timer) settles this, and a queued retry will see
    // the closed window and stop.
    if (busyRef.current && !sentRef.current && inFlightRef.current.size === 0) {
      const slot = lastSlotRef.current;
      if (slot) settleFailed(genRef.current, slot, 0, "closed", false);
    }
  }, [accepting, questionId, settleFailed]);

  // The signed room snapshot already holds this player's answer: the server has
  // it, so stop resending. If it later disappears (host undo), start clean.
  const hadServerAnswerRef = useRef(false);
  useEffect(() => {
    if (serverHasAnswer) {
      hadServerAnswerRef.current = true;
      sentRef.current = true;
      stopAll();
      clearPendingAnswer();
      if (busyRef.current) setStatus("sent");
      return;
    }
    if (!hadServerAnswerRef.current) return;
    hadServerAnswerRef.current = false;
    sentRef.current = false;
    busyRef.current = false;
    lastSlotRef.current = null;
    setChosenSlot(null);
    setFailure(null);
    setConfirmedAt(null);
    setStatus("idle");
  }, [serverHasAnswer, stopAll]);

  const begin = useCallback(
    (slot: 1 | 2 | 3 | 4) => {
      busyRef.current = true;
      sentRef.current = false;
      tapLogRef.current = { at: Date.now(), last: null };
      lastSlotRef.current = slot;
      savePendingAnswer({ questionId, slotChosen: slot });
      // Lock the choice on screen in this same frame, before any network work.
      setChosenSlot(slot);
      setFailure(null);
      setStatus("pending");
      runAttempt(slot, 0);
    },
    [runAttempt, questionId],
  );

  const submit = useCallback(
    (slot: 1 | 2 | 3 | 4) => {
      if (!acceptingRef.current) {
        // The phone's timer had already ended: record that the tap was ignored.
        diagEvent("tapx", { q: questionId, slot, why: "closed" }, true);
        return;
      }
      if (busyRef.current || serverHasAnswerRef.current) return;
      begin(slot);
    },
    [begin, questionId],
  );

  const retry = useCallback(() => {
    if (!acceptingRef.current) return;
    if (busyRef.current || serverHasAnswerRef.current) return;
    const slot = lastSlotRef.current;
    if (!slot) return;
    begin(slot);
  }, [begin]);

  return { status, submit, retry, confirmedAt, chosenSlot, failure };
}
