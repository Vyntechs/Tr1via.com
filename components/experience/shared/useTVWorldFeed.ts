// What every TV world reads from the TV, in one place (October and November
// both use it; never copy these rules into a month):
//
//   - the moment each screen announces (publish), with the question clock
//     and the broadcast's clock skew
//   - who is in the row: the game on screen's players, minus anyone silent
//     for 10+ minutes who isn't answering this question (gone home)
//   - the scale the 1600×900 stage is drawn at inside its box
//
// It reads only. A failure inside its timers reports through onFail (the
// world then switches off; the game carries on).

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { NO_MOMENT, sameMoment, type TVMoment } from "@/lib/experience/tvMoment";
import { momentSecondsLeft, type QuestionClock } from "@/lib/experience/october/patch";
import type { RowAnswer, RowPlayer } from "@/lib/experience/shared/playerRow";
import type { TVSnapshot } from "@/lib/hooks/useTVRoom";
import { gamePlayers } from "@/lib/tv/gamePlayers";

export const PRESENT_FOR_MS = 10 * 60_000;
const STAGE_W = 1600;
const STAGE_H = 900;

export function useTVWorldFeed(input: {
  snapshot: TVSnapshot;
  off: boolean;
  onFail: (error: unknown) => void;
  /** Name in the crash report, e.g. "november:world". */
  name: string;
  durationS: number;
}) {
  const { snapshot, off, onFail, name, durationS } = input;
  const [moment, setMoment] = useState<TVMoment>(NO_MOMENT);
  const [questionClock, setQuestionClock] = useState<QuestionClock | null>(null);
  const momentRef = useRef<TVMoment>(NO_MOMENT);
  const clockRef = useRef<QuestionClock | null>(null);
  const offsetRef = useRef(0);

  const publish = useCallback((raw: TVMoment) => {
    const next: TVMoment = {
      ...raw,
      revealedAtMs: finiteOrNull(raw.revealedAtMs),
      serverNowMs: finiteOrNull(raw.serverNowMs),
    };
    const prev = momentRef.current;
    if (sameMoment(prev, next)) return;
    if (next.kind === "question" && next.questionId && next.revealedAtMs !== null) {
      offsetRef.current = next.serverNowMs !== null ? next.serverNowMs - Date.now() : 0;
      clockRef.current = { questionId: next.questionId, revealedAtMs: next.revealedAtMs, endedAtMs: null };
      setQuestionClock(clockRef.current);
    } else if (prev.kind === "question" && clockRef.current && clockRef.current.endedAtMs === null) {
      clockRef.current = { ...clockRef.current, endedAtMs: Date.now() + offsetRef.current };
      setQuestionClock(clockRef.current);
    }
    momentRef.current = next;
    setMoment(next);
  }, []);

  const roster = useMemo(
    () =>
      [...gamePlayers({ players: snapshot.players, scores: snapshot.scores })].sort((a, b) =>
        String(a.joinedAt ?? "").localeCompare(String(b.joinedAt ?? "")),
      ),
    [snapshot.players, snapshot.scores],
  );
  const answers = useMemo<RowAnswer[]>(
    () =>
      snapshot.liveAnswers.map((a) => ({
        playerKey: a.player_key,
        questionId: a.question_id,
        isCorrect: a.is_correct,
      })),
    [snapshot.liveAnswers],
  );

  const onFailRef = useRef(onFail);
  useEffect(() => {
    onFailRef.current = onFail;
  });
  const report = useCallback(
    (error: unknown) => {
      console.warn(`[theme] "${name}" switched off after an error; the game keeps going.`, error);
      onFailRef.current(error);
    },
    [name],
  );

  const [players, setPlayers] = useState<RowPlayer[]>(() => roster.map(rowPlayer));
  useEffect(() => {
    if (off) return;
    const update = () => {
      try {
        const now = Date.now() + offsetRef.current;
        const answering = new Set(
          answers.filter((a) => a.questionId === momentRef.current.questionId).map((a) => a.playerKey),
        );
        const next = roster
          .filter((p) => {
            if (answering.has(p.id)) return true;
            const seen = Date.parse(p.lastSeenAt);
            return !Number.isFinite(seen) || now - seen < PRESENT_FOR_MS;
          })
          .map(rowPlayer);
        setPlayers((prev) =>
          prev.length === next.length && prev.every((p, i) => p.key === next[i].key && p.name === next[i].name)
            ? prev
            : next,
        );
      } catch (error) {
        report(error);
      }
    };
    const first = window.setTimeout(update, 0);
    const id = window.setInterval(update, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [roster, answers, moment, off, report]);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
  const secondsLeftNow = useCallback(
    () =>
      momentSecondsLeft({
        moment: momentRef.current,
        questionClock: clockRef.current,
        players: [],
        answers: [],
        serverNowMs: Date.now() + offsetRef.current,
        durationS,
      }),
    [durationS],
  );

  return { moment, questionClock, publish, players, answers, serverNow, secondsLeftNow, report };
}

/** Scale of the 1600×900 stage inside the root box (1 on the venue TV). */
export function useStageScale(rootRef: RefObject<HTMLDivElement | null>): number {
  const [stageScale, setStageScale] = useState(1);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width <= 0 || box.height <= 0) return;
      const next = Math.min(box.width / STAGE_W, box.height / STAGE_H);
      setStageScale((current) => (Math.abs(current - next) < 0.001 ? current : next));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [rootRef]);
  return stageScale;
}

const finiteOrNull = (value: number | null): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function rowPlayer(p: TVSnapshot["players"][number]): RowPlayer {
  return { key: String(p.id), name: typeof p.displayName === "string" ? p.displayName : "" };
}
