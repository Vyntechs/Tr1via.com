// useAnswerSubmit — optimistic POST /api/answers that keeps trying until the
// question closes.
//
// State machine:
//   idle     → submit(slot)          → pending     (the choice is held at once)
//   pending  → 204, 200 "confirmed", 409 "already answered" → sent (terminal for this question)
//   pending  → 5xx / network / slow  → retrying    (keeps going; backoff, no cap)
//   retrying → the same                → sent
//   *        → other 4xx             → failed      (reason "rejected": usually a bug)
//                                      408 / 425 / 429 are network-ish: they retry.
//   failed (rejected) also stops every other request still out, so nothing can
//   flip a refusal back to "retrying" or re-send the refused answer.
//   *        → the answer window ends→ failed      (reason "closed": never confirmed,
//                                      so it may still count: the stored answer stays
//                                      until a snapshot shows the row or the reveal)
//   *        → 400 "answer deadline passed" / "question is closed"
//                                      → failed      (reason "late" if this was the only
//                                      send and nothing else is out, otherwise "closed")
//   failed   → retry()               → pending     (manual re-attempt from the UI)
//   failed   → submit(otherSlot)     → pending     (change of mind after a refusal)
//
// "Slow" = no reply within the quiet timer, clamp(remainingMs - 1500, 1500, 6000).
// The 1,500 is a 1,000ms landing margin plus the 500ms first backoff, so the
// resend can still beat the deadline; none goes out with under 750ms left. The
// screen runs on its own attemptTimeoutMs (6 s) timer, so a slow reply near zero
// doesn't change the wording. Sends that fail outright retry as before. A slow request is
// NOT cancelled: on a bad venue connection it may still land, and cancelling it
// would restart the clock forever. The next attempt starts alongside it, at most
// MAX_IN_FLIGHT at once, and the first confirmation wins. The server is
// idempotent per (question, player), so duplicates answer 409 = success.
// What the server accepts, and when it stops accepting, is decided server-side:
// the phone only stops sending once its own timer has ended.
//
// "sent" is decided by the send response itself, not by a second room fetch,
// so the phone can say "Locked in" as soon as the server says so. Only a 204, a
// 200 with code "confirmed", or a 409 "already answered" counts; any other
// reply that cannot be read as a confirm (HTML page, empty body, bare 409) is
// treated as unconfirmed and retried.
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
 *  server confirmed, and the answer may still have landed; `late` = the only
 *  send was refused for missing the deadline, so it did not; `rejected` = the
 *  server refused the answer (or an explicit maxAttempts ran out). */
export type AnswerSubmitFailure = "closed" | "rejected" | "late";

export interface UseAnswerSubmitOptions {
  questionId: string;
  scramble: number[];
  /** False once the authoritative player timer reaches zero. */
  accepting?: boolean;
  /** Milliseconds left on the timer. Without it the quiet timer is a flat attemptTimeoutMs. */
  getRemainingMs?: () => number;
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
/** Landing margin plus the first backoff. See the header. */
const QUIET_MARGIN_MS = 1500;
/** No quiet resend leaves with less than this on the clock. */
const LAST_RESEND_MS = 750;

function quietTimeoutMs(remainingMs: number, attemptTimeoutMs: number): number {
  const floor = Math.min(QUIET_MARGIN_MS, attemptTimeoutMs);
  return Math.min(attemptTimeoutMs, Math.max(floor, remainingMs - QUIET_MARGIN_MS));
}

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
  // 408 (request timeout), 425 (too early) and 429 (too many requests) are
  // what a slow venue proxy or a busy server says about the NETWORK, not about
  // the answer, so they retry exactly like a dropped connection.
  return status >= 400 && status < 500 && status !== 409 && status !== 408 && status !== 425 && status !== 429;
}

/** "sent" = this very request was saved. "already" = the server said it already
 *  holds an answer (maybe another slot of ours). */
type Verdict = "sent" | "already" | "retry" | "rejected" | "late";

/** Reads a reply body as JSON, or null when it is empty or not JSON. */
async function readBody(
  res: Response,
): Promise<{ code?: unknown; error?: unknown; confirmedSlot?: unknown } | null> {
  try {
    const parsed = JSON.parse(await res.text()) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as { code?: unknown; error?: unknown; confirmedSlot?: unknown })
      : null;
  } catch {
    return null;
  }
}

/**
 * What a send reply means. Only two shapes count as "the server has it":
 * a 204, or a 200 whose JSON body says code "confirmed" (what our server
 * sends). Anything that cannot be read as one of those (a 200 with an HTML
 * page or an empty `{}`, a 409 with no reason) did not come from our server's
 * confirm path, so it is "retry": the phone keeps saying Sending and tries
 * again. If the answer was in fact saved, the next try gets 409 "already
 * answered" (or the saved row arrives) and locks in truthfully.
 */
async function judgeResponse(res: Response): Promise<{ verdict: Verdict; confirmedSlot?: 1 | 2 | 3 | 4 }> {
  if (res.status === 204) return { verdict: "sent" };
  if (res.status === 409) {
    // 409 is "already answered" (the server has it: success) but the same
    // status also means "question is not live" and the like. Only the first
    // may say "Locked in". A 409 with no readable reason is unconfirmed.
    const reason = (await readBody(res))?.error;
    if (typeof reason !== "string" || reason === "") return { verdict: "retry" };
    return { verdict: /already answered/i.test(reason) ? "already" : "rejected" };
  }
  if (res.status >= 200 && res.status < 300) {
    const body = await readBody(res);
    const code = body?.code;
    if (code === "confirmed") {
      // The server may name the card it holds; trust that over our own tap.
      const slot = body?.confirmedSlot;
      return {
        verdict: "sent",
        confirmedSlot: slot === 1 || slot === 2 || slot === 3 || slot === 4 ? slot : undefined,
      };
    }
    if (typeof code === "string" && code !== "retry_later") return { verdict: "rejected" };
    return { verdict: "retry" };
  }
  if (res.status === 400) {
    // The server looks for a saved row before refusing a late answer, so these
    // two mean it holds nothing for this player right now.
    const reason = (await readBody(res))?.error;
    if (reason === "answer deadline passed" || reason === "question is closed") {
      return { verdict: "late" };
    }
  }
  return { verdict: isTerminalClientError(res.status) ? "rejected" : "retry" };
}

export function useAnswerSubmit({
  questionId,
  scramble,
  accepting = true,
  getRemainingMs,
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
  // The answer was refused or the window closed: nothing may flip it back to
  // "retrying" or start another send until the player acts (Try again / pick).
  const failedRef = useRef(false);
  // Every slot this question has had a request for. A request we gave up on
  // may still have been saved, so a bare "already answered" only tells us which
  // card the server holds when exactly one slot was ever sent.
  const sentSlotsRef = useRef<Set<number>>(new Set());
  // Requests sent for this question, on this page or (after a refresh) an earlier
  // one. "Too late" is only certain when there was exactly one.
  const sendCountRef = useRef(0);
  // The server said the deadline has passed. A phone running slow can still show
  // time left, so no tap may start a new send.
  const refusedLateRef = useRef(false);
  const inFlightRef = useRef<Set<AbortController>>(new Set());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acceptingRef = useRef(accepting);
  acceptingRef.current = accepting;
  const serverHasAnswerRef = useRef(serverHasAnswer);
  const optsRef = useRef({ scramble, maxAttempts, backoffMs, attemptTimeoutMs, getRemainingMs });
  // Latest options for the timers and replies that outlive a render. Declared
  // before the effects below so it is current when they run.
  useEffect(() => {
    serverHasAnswerRef.current = serverHasAnswer;
    optsRef.current = { scramble, maxAttempts, backoffMs, attemptTimeoutMs, getRemainingMs };
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
    (gen: number, slot: number, tries: number, how: "own" | "already", confirmedSlot?: 1 | 2 | 3 | 4) => {
      if (gen !== genRef.current || sentRef.current) return;
      sentRef.current = true;
      busyRef.current = true;
      failedRef.current = false;
      stopAll();
      reportTap(slot, tries, true);
      clearPendingAnswer();
      setFailure(null);
      setConfirmedAt(Date.now());
      // Show the card the server really holds. A 204 / "confirmed" is this
      // request's own slot. "Already answered" is only that slot when it is the
      // only one we ever sent; otherwise no card is marked until the saved row
      // arrives and says which.
      if (how === "own") setChosenSlot(confirmedSlot ?? (slot as 1 | 2 | 3 | 4));
      else if (sentSlotsRef.current.size === 1) setChosenSlot(slot as 1 | 2 | 3 | 4);
      else setChosenSlot(null);
      setStatus("sent");
    },
    [reportTap, stopAll],
  );

  const settleFailed = useCallback(
    (gen: number, slot: number, tries: number, reason: AnswerSubmitFailure, keepStoredAnswer: boolean) => {
      if (gen !== genRef.current || sentRef.current) return;
      busyRef.current = false;
      failedRef.current = true;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      // A refusal ends this try for good: any other request still out must not
      // later flip the line back to "retrying" or re-send the refused answer.
      // (A closed window or a late refusal leaves them alone: one may still
      // land and lock in.)
      if (reason === "rejected" && !keepStoredAnswer) stopAll();
      reportTap(slot, tries, false);
      // Refused: nothing useful to resume later. Window closed unconfirmed: the
      // answer may still count, so it stays until a snapshot shows the row or
      // the reveal. Out of attempts (explicit maxAttempts): leave it so a
      // refresh can re-fire.
      if (!keepStoredAnswer) clearPendingAnswer();
      setFailure(reason);
      setStatus("failed");
    },
    [reportTap, stopAll],
  );

  const runAttempt = useCallback(
    (slot: 1 | 2 | 3 | 4, attempt: number) => {
      const gen = genRef.current;
      if (sentRef.current) return;
      if (!acceptingRef.current) {
        settleFailed(gen, slot, attempt, "closed", true);
        return;
      }
      const tries = attempt + 1;
      sendCountRef.current += 1;
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
      let quietTimer: ReturnType<typeof setTimeout> | null = null;
      let statusTimer: ReturnType<typeof setTimeout> | null = null;
      const finish = () => {
        if (quietTimer) clearTimeout(quietTimer);
        if (statusTimer) clearTimeout(statusTimer);
        flying.delete(ctrl);
      };
      const followUp = (quiet: boolean) => {
        if (followed || ctrl.signal.aborted || failedRef.current) return;
        if (gen !== genRef.current || sentRef.current) return;
        if (!acceptingRef.current) {
          // Past zero a quiet send just keeps waiting: the status timer decides
          // when the words change, however short the quiet timer ran.
          if (quiet) return;
          followed = true;
          settleFailed(gen, slot, tries, "closed", true);
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
        const { backoffMs: schedule, getRemainingMs: remaining } = optsRef.current;
        // A quiet resend is racing the deadline, so it always takes the first
        // step: the quiet timer's margin assumes that. Outright failures back off.
        const step = quiet ? 0 : Math.min(attempt, schedule.length - 1);
        const base = schedule[step] ?? schedule[schedule.length - 1] ?? 1000;
        // A little spread so a whole room does not retry on the same beat.
        const delay = base > 0 ? Math.round(base * (0.8 + Math.random() * 0.4)) : 0;
        // Too close to zero to land. This request may still answer; if it fails
        // outright, or the window closes first, that path settles it.
        if (quiet && remaining && remaining() - delay < LAST_RESEND_MS) return;
        followed = true;
        // Only an outright failure changes the words here; a quiet send leaves
        // that to the status timer below.
        if (!quiet) setStatus("retrying");
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          if (gen === genRef.current) runAttempt(slot, attempt + 1);
        }, delay);
      };

      const { attemptTimeoutMs: statusMs, getRemainingMs: remainingNow } = optsRef.current;
      quietTimer = setTimeout(
        () => followUp(true),
        remainingNow ? quietTimeoutMs(remainingNow(), statusMs) : statusMs,
      );
      statusTimer = setTimeout(() => {
        if (ctrl.signal.aborted || failedRef.current) return;
        if (gen !== genRef.current || sentRef.current) return;
        if (!acceptingRef.current) settleFailed(gen, slot, tries, "closed", true);
        else if (tries < optsRef.current.maxAttempts) setStatus("retrying");
      }, statusMs);

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
          if (gen !== genRef.current || ctrl.signal.aborted) return finish();
          const { verdict, confirmedSlot } = await judgeResponse(res);
          finish();
          // Gave up on (answered elsewhere, refused, a new pick): not ours any more.
          if (gen !== genRef.current || ctrl.signal.aborted) return;
          if (verdict === "sent") settleSent(gen, slot, tries, "own", confirmedSlot);
          else if (verdict === "already") settleSent(gen, slot, tries, "already", undefined);
          else if (verdict === "rejected") settleFailed(gen, slot, tries, "rejected", false);
          else if (verdict === "late") {
            refusedLateRef.current = true;
            // Sure only if this was the one send and nothing else is out. With
            // more, one may yet confirm, so keep checking and leave them running.
            const alone = sendCountRef.current === 1 && inFlightRef.current.size === 0;
            settleFailed(gen, slot, tries, alone ? "late" : "closed", !alone);
          } else followUp(false);
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
    failedRef.current = false;
    sentSlotsRef.current = new Set();
    sendCountRef.current = 0;
    refusedLateRef.current = false;
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
        if (serverHasAnswerRef.current) {
          clearPendingAnswer();
        } else if (acceptingRef.current) {
          busyRef.current = true;
          lastSlotRef.current = pending.slotChosen;
          sentSlotsRef.current.add(pending.slotChosen);
          // The page before this one sent at least once.
          sendCountRef.current = 1;
          tapLogRef.current = { at: Date.now(), last: null, resumed: true }; // diagnostic log only
          setChosenSlot(pending.slotChosen);
          setStatus("pending");
          runAttempt(pending.slotChosen, 0);
        } else {
          // Refreshed after zero with the answer still unconfirmed: it can't be
          // sent again, but it may have landed. Show the pick and keep checking.
          failedRef.current = true;
          lastSlotRef.current = pending.slotChosen;
          sentSlotsRef.current.add(pending.slotChosen);
          setChosenSlot(pending.slotChosen);
          setFailure("closed");
          setStatus("failed");
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
    // The window just ended. If nothing is in flight, nothing more can be
    // sent: say so now. If a request is still out, it may yet land; its
    // reply (or its quiet timer) settles this, and a queued retry will see
    // the closed window and stop.
    if (busyRef.current && !sentRef.current && inFlightRef.current.size === 0) {
      const slot = lastSlotRef.current;
      if (slot) settleFailed(genRef.current, slot, 0, "closed", true);
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
    failedRef.current = false;
    sentSlotsRef.current = new Set();
    sendCountRef.current = 0;
    refusedLateRef.current = false;
    lastSlotRef.current = null;
    setChosenSlot(null);
    setFailure(null);
    setConfirmedAt(null);
    setStatus("idle");
  }, [serverHasAnswer, stopAll]);

  const begin = useCallback(
    (slot: 1 | 2 | 3 | 4) => {
      // A new try (Try again, or a different card after a refusal) replaces
      // whatever is still out from the last one.
      stopAll();
      busyRef.current = true;
      sentRef.current = false;
      failedRef.current = false;
      sentSlotsRef.current.add(slot);
      tapLogRef.current = { at: Date.now(), last: null };
      lastSlotRef.current = slot;
      savePendingAnswer({ questionId, slotChosen: slot });
      // Lock the choice on screen in this same frame, before any network work.
      setChosenSlot(slot);
      setFailure(null);
      setStatus("pending");
      runAttempt(slot, 0);
    },
    [runAttempt, questionId, stopAll],
  );

  const submit = useCallback(
    (slot: 1 | 2 | 3 | 4) => {
      if (!acceptingRef.current) {
        // The phone's timer had already ended: record that the tap was ignored.
        diagEvent("tapx", { q: questionId, slot, why: "closed" }, true);
        return;
      }
      if (busyRef.current || serverHasAnswerRef.current || refusedLateRef.current) return;
      begin(slot);
    },
    [begin, questionId],
  );

  const retry = useCallback(() => {
    if (!acceptingRef.current || refusedLateRef.current) return;
    if (busyRef.current || serverHasAnswerRef.current) return;
    const slot = lastSlotRef.current;
    if (!slot) return;
    begin(slot);
  }, [begin]);

  return { status, submit, retry, confirmedAt, chosenSlot, failure };
}
