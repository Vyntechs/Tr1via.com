// November · fetch the phone pictures in small sets after a player has
// joined, each at a random moment so 40 phones never ask at once. See
// phonePreloadWaves in lib/experience/november/phone.ts for what and when.

"use client";

import { phonePreloadWaves, type PhonePreloadWaves } from "@/lib/experience/november/phone";

// Held on purpose: a referenced, decoded Image keeps its picture in the
// page's memory cache, so the strip swap later needs no network at all.
const kept = new Map<string, HTMLImageElement>();

function fetchAll(urls: readonly string[]): void {
  for (const url of urls) {
    if (kept.has(url)) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    kept.set(url, img);
  }
}

/** Fetches one set at a random moment between `afterMs` and `afterMs` + 5 s
 *  from now (1-6 s by default; each picture once per page). Returns a cancel
 *  for a set that has not started yet. */
export function scheduleNovemberPhonePreload(set: keyof PhonePreloadWaves, afterMs = 1000): () => void {
  if (typeof window === "undefined" || typeof Image === "undefined") return () => {};
  const urls = phonePreloadWaves()[set];
  const id = window.setTimeout(() => fetchAll(urls), afterMs + Math.random() * 5000);
  return () => window.clearTimeout(id);
}

/**
 * Starts loading one picture now (sharing the held copy with the sets above)
 * and calls `onDone` once: true when it has loaded, false when it failed or
 * had not arrived after `timeoutMs` (null = wait as long as it takes). Returns a cancel that removes the
 * listeners and the timer without calling `onDone`. Never throws.
 */
export function whenNovemberPhoneArtReady(url: string, timeoutMs: number | null, onDone: (ok: boolean) => void): () => void {
  let img: HTMLImageElement | undefined;
  let timer: number | undefined;
  let settled = false;
  let listening = false;
  const cleanup = () => {
    settled = true;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    if (listening) {
      listening = false;
      img?.removeEventListener("load", onLoad);
      img?.removeEventListener("error", onError);
    }
  };
  const finish = (ok: boolean) => {
    if (settled) return;
    cleanup();
    onDone(ok);
  };
  function onLoad() {
    finish(true);
  }
  function onError() {
    finish(false);
  }
  try {
    if (typeof window === "undefined" || typeof Image === "undefined") {
      onDone(false);
      return () => {};
    }
    img = kept.get(url);
    if (!img) {
      img = new Image();
      img.decoding = "async";
      img.src = url;
      kept.set(url, img);
    }
    if (img.complete) {
      // A broken picture is "complete" too: only a real size means loaded.
      const ok = img.naturalWidth > 0;
      settled = true;
      onDone(ok);
      return () => {};
    }
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
    listening = true;
    if (timeoutMs !== null) timer = window.setTimeout(() => finish(false), timeoutMs);
  } catch {
    finish(false);
  }
  return cleanup;
}

/** Tests only: forget every held picture. */
export function resetNovemberPhoneArtForTests(): void {
  kept.clear();
}
