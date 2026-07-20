"use client";

import { useEffect, useState } from "react";
import type { LiveRevision } from "@/lib/host/gameDelivery";
import type { HostDeliveryReceipt } from "@/components/host/HostGameStatus";

const OBSERVATION_HEARTBEAT_MS = 15_000;
const FAST_POLL_MS = 1_000;
const SLOW_POLL_MS = 4_000;

function revisionKey(revision: LiveRevision | null): string {
  return revision
    ? `${revision.runId ?? "none"}:${revision.roomRevision}:${revision.controlRevision}:${revision.playId ?? "none"}`
    : "none";
}

function sameRevision(a: LiveRevision, b: LiveRevision): boolean {
  return revisionKey(a) === revisionKey(b);
}

export function useSurfaceObservation({
  endpoint,
  canonical,
  enabled = true,
}: {
  endpoint: string;
  canonical: LiveRevision | null;
  enabled?: boolean;
}) {
  const key = revisionKey(canonical);
  useEffect(() => {
    if (!enabled || !canonical || !canonical.runId) return;
    const controller = new AbortController();
    const send = () => {
      void fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(canonical),
        cache: "no-store",
        signal: controller.signal,
      }).catch(() => undefined);
    };
    // Effects run only after React commits the canonical frame to the screen.
    send();
    const heartbeat = window.setInterval(send, OBSERVATION_HEARTBEAT_MS);
    return () => {
      controller.abort();
      window.clearInterval(heartbeat);
    };
  }, [canonical, enabled, endpoint, key]);
}

interface DeliveryResponse {
  tv: "current" | "recovering";
  currentPhones: number;
  recoveringPhones: number;
  canonical: LiveRevision;
}

function isDeliveryResponse(value: unknown): value is DeliveryResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DeliveryResponse>;
  return (candidate.tv === "current" || candidate.tv === "recovering") &&
    Number.isInteger(candidate.currentPhones) && Number(candidate.currentPhones) >= 0 &&
    Number.isInteger(candidate.recoveringPhones) && Number(candidate.recoveringPhones) >= 0 &&
    Boolean(candidate.canonical);
}

export function useGameDelivery({
  roomCode,
  canonical,
  stageKey,
  enabled = true,
}: {
  roomCode: string;
  canonical: LiveRevision | null;
  stageKey: string;
  enabled?: boolean;
}): HostDeliveryReceipt {
  const [receipt, setReceipt] = useState<HostDeliveryReceipt>({
    tv: "unknown",
    currentPhones: null,
    recoveringPhones: null,
    isSending: false,
    isAvailable: true,
  });
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const canonicalKey = revisionKey(canonical);
  const requestKey = `${canonicalKey}:${stageKey}`;

  useEffect(() => {
    if (!enabled || !canonical || !canonical.runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const startedAt = Date.now();

    const poll = async () => {
      if (stopped) return;
      setSettledKey(null);
      let nextDelay = Date.now() - startedAt < 10_000 ? FAST_POLL_MS : SLOW_POLL_MS;
      try {
        const response = await fetch(`/api/host/rooms/${roomCode}/delivery`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = response.ok ? await response.json() : null;
        if (isDeliveryResponse(body) && sameRevision(body.canonical, canonical)) {
          setReceipt({
            tv: body.tv,
            currentPhones: body.currentPhones,
            recoveringPhones: body.recoveringPhones,
            isSending: false,
            isAvailable: true,
          });
          setSettledKey(requestKey);
          if (body.tv === "current" && body.recoveringPhones === 0) {
            // A confirmed receipt is retained, then rechecked slowly so a TV
            // or phone that later disappears cannot look current forever.
            nextDelay = OBSERVATION_HEARTBEAT_MS;
          }
        } else {
          setSettledKey(null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSettledKey(null);
        }
        nextDelay = SLOW_POLL_MS;
      }
      if (!stopped) timer = setTimeout(poll, nextDelay);
    };

    void poll();
    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [canonical, canonicalKey, enabled, requestKey, roomCode, stageKey]);

  if (!enabled) {
    return {
      tv: "unknown",
      currentPhones: null,
      recoveringPhones: null,
      isSending: false,
      isAvailable: false,
    };
  }
  if (settledKey !== requestKey) {
    return {
      tv: "unknown",
      currentPhones: null,
      recoveringPhones: null,
      isSending: true,
      isAvailable: true,
    };
  }
  return receipt;
}
