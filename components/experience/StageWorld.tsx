// Shared wiring between a TV world (mounted once per screen, above the TV's
// screen switcher) and the TV screens it sits behind.
//
// - StageWorldContext: present only while a world is on. TVStage reads it to
//   step aside: it stops painting its own background and weather, and keeps
//   to the top part of the screen so the world's foreground has the bottom.
//   With no world mounted it is null and every screen renders as before.
// - usePublishTVMoment: each TV screen announces which moment of the night it
//   is showing, so the world can react. A no-op when no world is listening.

"use client";

import { createContext, useContext, useEffect } from "react";
import type { TVWorldSpec } from "@/lib/experience/packs";
import type { TVMoment } from "@/lib/experience/tvMoment";

export const StageWorldContext = createContext<TVWorldSpec | null>(null);

export function useStageWorld(): TVWorldSpec | null {
  return useContext(StageWorldContext);
}

export const TVMomentPublisherContext = createContext<((moment: TVMoment) => void) | null>(
  null,
);

export function usePublishTVMoment(moment: TVMoment): void {
  const publish = useContext(TVMomentPublisherContext);
  const { kind, questionId, revealedAtMs, serverNowMs } = moment;
  useEffect(() => {
    publish?.({ kind, questionId, revealedAtMs, serverNowMs });
  }, [publish, kind, questionId, revealedAtMs, serverNowMs]);
}
