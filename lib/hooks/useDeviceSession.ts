// Player-side device session hook. The wire of trust is the signed,
// HTTP-only `tr1via_device` cookie, which browser JavaScript never receives.
// On first mount, POST /api/session/init verifies the existing cookie or mints
// a replacement and returns only whether the session is ready.
//
// Returns `{ isReady, isLoading }`. `isLoading` covers the first attempt only;
// after a transient failure the UI can show its offline state while this hook
// keeps recovering in the background with capped backoff and online/focus
// wakeups.

"use client";

import { useEffect, useState } from "react";

const STALE_STORAGE_KEY = "tr1via_device_id";
const RETRY_BASE_MS = 1_000;
const RETRY_CAP_MS = 15_000;

export interface DeviceSession {
  isReady: boolean;
  isLoading: boolean;
}

interface InitResponse {
  ready: boolean;
}

export function useDeviceSession(): DeviceSession {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let ready = false;
    let inFlight = false;
    let retryImmediatelyAfterFlight = false;
    let failureCount = 0;
    let retryTimer: number | null = null;

    try {
      // Remove the browser-readable identity left by older releases.
      window.localStorage.removeItem(STALE_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private mode; the cookie still works.
    }

    function clearRetryTimer() {
      if (retryTimer === null) return;
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }

    function scheduleRetry() {
      if (cancelled || ready || retryTimer !== null) return;
      const exponent = Math.max(0, Math.min(failureCount - 1, 20));
      const delay = Math.min(RETRY_BASE_MS * 2 ** exponent, RETRY_CAP_MS);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void ensureSession();
      }, delay);
    }

    async function ensureSession() {
      if (cancelled || ready) return;
      if (inFlight) {
        retryImmediatelyAfterFlight = true;
        return;
      }

      inFlight = true;
      let succeeded = false;
      try {
        const res = await fetch("/api/session/init", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as InitResponse;
        if (cancelled || data.ready !== true) return;
        ready = true;
        succeeded = true;
        clearRetryTimer();
        setIsReady(true);
      } catch {
        // A timer or connectivity event will try again. The signed cookie
        // remains the only authority; recovery never invents client identity.
      } finally {
        inFlight = false;
        if (cancelled) return;
        setIsLoading(false);
        if (succeeded || ready) return;

        failureCount += 1;
        if (retryImmediatelyAfterFlight) {
          retryImmediatelyAfterFlight = false;
          void ensureSession();
          return;
        }
        scheduleRetry();
      }
    }

    function retryNow() {
      if (cancelled || ready) return;
      clearRetryTimer();
      if (inFlight) {
        retryImmediatelyAfterFlight = true;
        return;
      }
      void ensureSession();
    }

    window.addEventListener("online", retryNow);
    window.addEventListener("focus", retryNow);
    void ensureSession();
    return () => {
      cancelled = true;
      clearRetryTimer();
      window.removeEventListener("online", retryNow);
      window.removeEventListener("focus", retryNow);
    };
  }, []);

  return { isReady, isLoading };
}
