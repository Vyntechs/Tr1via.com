// Player-side device session hook. The wire of trust is the signed,
// HTTP-only `tr1via_device` cookie, which browser JavaScript never receives.
// On first mount, POST /api/session/init verifies the existing cookie or mints
// a replacement and returns only whether the session is ready.
//
// Returns `{ isReady, isLoading }`. While `isLoading` is true the caller
// should render a neutral placeholder (no flash of "no session" state).

"use client";

import { useEffect, useState } from "react";

const STALE_STORAGE_KEY = "tr1via_device_id";

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

    try {
      // Remove the browser-readable identity left by older releases.
      window.localStorage.removeItem(STALE_STORAGE_KEY);
    } catch {
      // Storage can be unavailable in private mode; the cookie still works.
    }

    async function ensureSession() {
      try {
        const res = await fetch("/api/session/init", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as InitResponse;
        if (cancelled) return;
        setIsReady(data.ready === true);
      } catch {
        // Network down; we still want the loading state to clear so the
        // UI can show an offline state instead of spinning forever.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void ensureSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return { isReady, isLoading };
}
