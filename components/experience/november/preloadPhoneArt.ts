// November · fetch every phone picture once, the first time a phone shows the
// Harvest Field, and keep them in memory for the rest of the night. See
// phonePreloadUrls in lib/experience/november/phone.ts for why.

"use client";

import { phonePreloadUrls } from "@/lib/experience/november/phone";

// Held on purpose: a referenced, decoded Image keeps its picture in the
// page's memory cache, so the strip swap later needs no network at all.
const kept: HTMLImageElement[] = [];

export function preloadNovemberPhoneArt(): void {
  if (kept.length > 0 || typeof window === "undefined" || typeof Image === "undefined") return;
  for (const url of phonePreloadUrls()) {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    kept.push(img);
  }
}
