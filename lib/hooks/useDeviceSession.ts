// Player-side device session hook. The wire of trust is the signed
// `tr1via_device` httpOnly cookie — but the cookie isn't readable from JS,
// so we mirror the resolved deviceId into localStorage for fast subsequent
// reads. On first mount, we POST /api/session/init which either returns
// the existing id (cookie present + verified) or mints a new one.
//
// Returns `{ deviceId, isLoading }`. While `isLoading` is true the caller
// should render a neutral placeholder (no flash of "no session" state).

"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "tr1via_device_id";

export interface DeviceSession {
  deviceId: string | null;
  isLoading: boolean;
}

interface InitResponse {
  deviceId: string;
}

export function useDeviceSession(): DeviceSession {
  const [deviceId, setDeviceId] = useState<string | null>(() => {
    // SSR / first paint: nothing to do until effects run.
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return !window.localStorage.getItem(STORAGE_KEY);
    } catch {
      return true;
    }
  });

  useEffect(() => {
    let cancelled = false;

    async function ensureSession() {
      try {
        const res = await fetch("/api/session/init", {
          method: "POST",
          credentials: "same-origin",
        });
        if (!res.ok) {
          if (!cancelled) setIsLoading(false);
          return;
        }
        const data = (await res.json()) as InitResponse;
        if (cancelled) return;
        if (data.deviceId) {
          try {
            window.localStorage.setItem(STORAGE_KEY, data.deviceId);
          } catch {
            /* private mode, quota — ignore */
          }
          setDeviceId(data.deviceId);
        }
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

  return { deviceId, isLoading };
}
