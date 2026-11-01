// November · fetch the phone pictures in two small waves after a player has
// joined, each at a random moment so 40 phones never ask at once. See
// phonePreloadWaves in lib/experience/november/phone.ts for what and why.

"use client";

import { phonePreloadWaves } from "@/lib/experience/november/phone";

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

/** Starts the waves (soon: 1-6 s after the call, later: 16-21 s). Returns a
 *  cancel for waves that have not started yet. Safe to call again. */
export function scheduleNovemberPhonePreload(): () => void {
  if (typeof window === "undefined" || typeof Image === "undefined") return () => {};
  const waves = phonePreloadWaves();
  const jitter = () => 1000 + Math.random() * 5000;
  const timers = [
    window.setTimeout(() => fetchAll(waves.soon), jitter()),
    window.setTimeout(() => fetchAll(waves.later), 15_000 + jitter()),
  ];
  return () => timers.forEach((id) => window.clearTimeout(id));
}
