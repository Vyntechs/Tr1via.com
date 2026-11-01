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

/** Fetches one set 1-6 s from now (each picture once per page). Returns a
 *  cancel for a set that has not started yet. */
export function scheduleNovemberPhonePreload(set: keyof PhonePreloadWaves): () => void {
  if (typeof window === "undefined" || typeof Image === "undefined") return () => {};
  const urls = phonePreloadWaves()[set];
  const id = window.setTimeout(() => fetchAll(urls), 1000 + Math.random() * 5000);
  return () => window.clearTimeout(id);
}
