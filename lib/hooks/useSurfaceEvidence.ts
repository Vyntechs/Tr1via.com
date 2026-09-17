"use client";

import { useEffect, useRef } from "react";

export type SurfaceEvidenceFrameKind =
  | "question_open"
  | "timer_zero"
  | "answer_reveal";

export interface SurfaceEvidenceFrame {
  questionId: string;
  frameKind: SurfaceEvidenceFrameKind;
  /** Client-only render cycle discriminator; never sent or trusted. */
  instanceKey?: string;
}

export interface UseSurfaceEvidenceOptions {
  /** Authenticated, same-origin host receipt route. */
  endpoint: string;
  /** The exact host frame that has committed, or null outside a tracked frame. */
  frame: SurfaceEvidenceFrame | null;
  /** Public-safe build/deployment identifier. Invalid values become "unknown". */
  clientRelease: string;
  enabled?: boolean;
}

interface SurfaceEvidencePayload extends SurfaceEvidenceFrame {
  surfaceInstanceId: string;
  clientRelease: string;
}

interface EvidenceTask {
  key: string;
  endpoint: string;
  payload: SurfaceEvidencePayload;
}

interface ActiveRequest {
  controller: AbortController;
}

export const SURFACE_EVIDENCE_TAB_KEY = "tr1via:surface-evidence-tab";
export const SURFACE_EVIDENCE_TIMEOUT_MS = 1_500;

const MAX_RELEASE_LENGTH = 128;
const SAFE_RELEASE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let memoryTabId: string | null = null;

function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  // Modern browsers expose randomUUID, but keep a standards-shaped fallback
  // so disabled/private storage never turns evidence into a rendering error.
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function surfaceInstanceId(): string {
  if (memoryTabId) return memoryTabId;
  try {
    const stored = window.sessionStorage.getItem(SURFACE_EVIDENCE_TAB_KEY);
    if (stored && UUID_PATTERN.test(stored)) {
      memoryTabId = stored;
      return stored;
    }
    const created = randomUuid();
    window.sessionStorage.setItem(SURFACE_EVIDENCE_TAB_KEY, created);
    memoryTabId = created;
    return created;
  } catch {
    // Some privacy modes disable sessionStorage. A memory-only id remains
    // stable for this loaded tab and never prevents the host UI from working.
    memoryTabId = randomUuid();
    return memoryTabId;
  }
}

export function safeSurfaceEvidenceRelease(value: string): string {
  const release = value.trim();
  return release.length > 0 &&
    release.length <= MAX_RELEASE_LENGTH &&
    SAFE_RELEASE.test(release)
    ? release
    : "unknown";
}

function frameKey(
  endpoint: string,
  frame: SurfaceEvidenceFrame,
  clientRelease: string,
): string {
  return `${endpoint}:${clientRelease}:${frame.questionId}:${frame.frameKind}:${frame.instanceKey ?? ""}`;
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function postWithTimeout(
  endpoint: string,
  payload: SurfaceEvidencePayload,
  controller: AbortController,
): Promise<Response> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let removeAbortListener = () => {};

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("surface evidence timed out"));
    }, SURFACE_EVIDENCE_TIMEOUT_MS);
  });
  const abortPromise = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(new Error("surface evidence aborted"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => controller.signal.removeEventListener("abort", onAbort);
  });

  try {
    return await Promise.race([
      fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      }),
      timeoutPromise,
      abortPromise,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    removeAbortListener();
  }
}

/**
 * Sends private, best-effort evidence that the host browser displayed a frame.
 *
 * This hook is intentionally write-only and render-less. Receipt success or
 * failure never reaches React state and therefore cannot affect the timer,
 * controls, resolution, scoring, or any visible game behavior.
 */
export function useSurfaceEvidence({
  endpoint,
  frame,
  clientRelease,
  enabled = true,
}: UseSurfaceEvidenceOptions): void {
  const mountedRef = useRef(false);
  const currentFrameKeyRef = useRef<string | null>(null);
  const lastQueuedKeyRef = useRef<string | null>(null);
  const queueRef = useRef<EvidenceTask[]>([]);
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const flushRef = useRef<() => void>(() => {});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueRef.current = [];
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
    };
  }, []);

  flushRef.current = () => {
    if (!mountedRef.current || activeRequestRef.current) return;
    const task = queueRef.current.shift();
    if (!task) return;

    const run = async () => {
      let attempt = 0;
      while (attempt < 2 && mountedRef.current) {
        const controller = new AbortController();
        activeRequestRef.current = { controller };
        try {
          const response = await postWithTimeout(
            task.endpoint,
            task.payload,
            controller,
          );
          if (response.ok || !retryableStatus(response.status)) return;
        } catch {
          // Evidence is best-effort. A network error or timeout may retry once
          // below, but never escapes into the host UI.
        }

        attempt += 1;
        if (
          attempt >= 2 ||
          !mountedRef.current ||
          currentFrameKeyRef.current !== task.key ||
          document.visibilityState !== "visible"
        ) {
          return;
        }
      }
    };

    void run().finally(() => {
      activeRequestRef.current = null;
      if (mountedRef.current) flushRef.current();
    });
  };

  useEffect(() => {
    const safeRelease = safeSurfaceEvidenceRelease(clientRelease);
    const key = enabled && frame
      ? frameKey(endpoint, frame, safeRelease)
      : null;
    currentFrameKeyRef.current = key;

    if (!enabled || !frame || !key) return;

    let firstPaint: number | null = null;
    let secondPaint: number | null = null;

    const cancelPaintWait = () => {
      if (firstPaint !== null) cancelAnimationFrame(firstPaint);
      if (secondPaint !== null) cancelAnimationFrame(secondPaint);
      firstPaint = null;
      secondPaint = null;
    };

    const queueAfterPaint = () => {
      if (
        document.visibilityState !== "visible" ||
        currentFrameKeyRef.current !== key ||
        lastQueuedKeyRef.current === key ||
        firstPaint !== null ||
        secondPaint !== null
      ) {
        return;
      }

      firstPaint = requestAnimationFrame(() => {
        firstPaint = null;
        if (
          document.visibilityState !== "visible" ||
          currentFrameKeyRef.current !== key
        ) {
          return;
        }
        secondPaint = requestAnimationFrame(() => {
          secondPaint = null;
          if (
            document.visibilityState !== "visible" ||
            currentFrameKeyRef.current !== key ||
            lastQueuedKeyRef.current === key
          ) {
            return;
          }
          lastQueuedKeyRef.current = key;
          queueRef.current.push({
            key,
            endpoint,
            payload: {
              questionId: frame.questionId,
              frameKind: frame.frameKind,
              surfaceInstanceId: surfaceInstanceId(),
              clientRelease: safeRelease,
            },
          });
          flushRef.current();
        });
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") queueAfterPaint();
      else cancelPaintWait();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    queueAfterPaint();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      cancelPaintWait();
    };
  }, [
    clientRelease,
    enabled,
    endpoint,
    frame?.frameKind,
    frame?.instanceKey,
    frame?.questionId,
  ]);
}
