// Intake rules for device reports (POST /api/diag/report).
//
// Pure functions, no I/O, so the size / shape / rate limits are easy to test.
// Nothing a device sends is trusted: the batch is rebuilt field by field from
// an allowlist, every number and string is bounded, and anything unexpected
// is dropped rather than stored.

import {
  DIAG_DEVICE_KINDS,
  DIAG_MAX_EVENTS_PER_BATCH,
  DIAG_MAX_EVENT_BYTES,
  DIAG_SURFACES,
  type DiagSurface,
} from "./config";

export type DiagValue = string | number | boolean | null | DiagValue[] | { [key: string]: DiagValue };

export interface CleanEvent {
  /** Device clock, ms since epoch. */
  t: number;
  k: string;
  d: Record<string, DiagValue>;
  forced: boolean;
}

export interface CleanBatch {
  surface: DiagSurface;
  /** Room code (phones, TV) or night id (host). */
  room: string | null;
  night: string | null;
  sid: string;
  /** Device clock when the batch was sent, ms since epoch. */
  sentAt: number;
  events: CleanEvent[];
}

const KIND_SET = new Set<string>(DIAG_DEVICE_KINDS);
const SURFACE_SET = new Set<string>(DIAG_SURFACES);
const KEY_RE = /^[a-z][a-z0-9_]{0,19}$/i;
const SID_RE = /^[A-Za-z0-9_-]{6,48}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_RE = /^[A-Za-z0-9·.\- ]{4,12}$/;
const MAX_STRING = 80;
// An event older than this when the batch is sent, or from the future, is junk.
const MAX_AGE_MS = 30 * 60_000;
const MAX_FUTURE_MS = 60_000;
const MIN_EPOCH_MS = 1_577_836_800_000; // 2020-01-01
const MAX_EPOCH_MS = 4_102_444_800_000; // 2100-01-01

function cleanString(value: string): string {
  // Control characters out, query strings and fragments off anything URL-shaped.
  let out = value.replace(/[\u0000-\u001f\u007f]/g, "");
  if (out.startsWith("/") || out.startsWith("http")) out = out.split(/[?#]/)[0];
  return out.slice(0, MAX_STRING);
}

function cleanValue(value: unknown, depth: number): DiagValue | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : undefined;
    case "string":
      return cleanString(value);
    case "object": {
      if (depth >= 2) return undefined;
      if (Array.isArray(value)) {
        const items: DiagValue[] = [];
        for (const item of value.slice(0, 8)) {
          const clean = cleanValue(item, depth + 1);
          if (clean !== undefined) items.push(clean);
        }
        return items;
      }
      const out: { [key: string]: DiagValue } = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>).slice(0, 24)) {
        if (!KEY_RE.test(key)) continue;
        const clean = cleanValue(inner, depth + 1);
        if (clean !== undefined) out[key] = clean;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** Rebuild an event payload from the allowlist, or null if it can't be kept. */
export function cleanEventData(raw: unknown): Record<string, DiagValue> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const clean = cleanValue(raw, 0);
  if (!clean || typeof clean !== "object" || Array.isArray(clean)) return {};
  if (JSON.stringify(clean).length > DIAG_MAX_EVENT_BYTES) return { trunc: true };
  return clean;
}

export function sanitizeBatch(raw: unknown): CleanBatch | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;

  const surface = body.surface;
  if (typeof surface !== "string" || !SURFACE_SET.has(surface)) return null;
  const sid = body.sid;
  if (typeof sid !== "string" || !SID_RE.test(sid)) return null;
  const sentAt = body.sent;
  // Any believable date (a phone with a wrong clock is still useful to us).
  if (typeof sentAt !== "number" || !(sentAt > MIN_EPOCH_MS && sentAt < MAX_EPOCH_MS)) return null;

  const room = typeof body.room === "string" && ROOM_RE.test(body.room) ? body.room : null;
  const night = typeof body.night === "string" && UUID_RE.test(body.night) ? body.night : null;
  if (!room && !night) return null;

  const list = Array.isArray(body.ev) ? body.ev.slice(0, DIAG_MAX_EVENTS_PER_BATCH) : [];
  const events: CleanEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e.k !== "string" || !KIND_SET.has(e.k)) continue;
    if (typeof e.t !== "number" || !Number.isFinite(e.t)) continue;
    const age = sentAt - e.t;
    if (age > MAX_AGE_MS || age < -MAX_FUTURE_MS) continue;
    events.push({
      t: Math.round(e.t),
      k: e.k,
      d: cleanEventData(e.d),
      forced: e.f === 1 || e.f === true,
    });
  }
  return { surface: surface as DiagSurface, room, night, sid, sentAt, events };
}

// ─── a short, readable description of the device ─────────────────────
export function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "unknown";
  const clean = ua.replace(/[\u0000-\u001f\u007f]/g, "");
  const pick = (re: RegExp) => re.exec(clean)?.[1];

  let os = "other";
  const ios = pick(/OS (\d+[_\d]*) like Mac OS X/);
  const android = pick(/Android (\d+(?:\.\d+)?)/);
  const mac = pick(/Mac OS X (\d+[_\d]*)/);
  if (ios) os = `${/iPad/.test(clean) ? "iPadOS" : "iOS"} ${ios.replace(/_/g, ".")}`;
  else if (android) os = `Android ${android}`;
  else if (/Windows NT/.test(clean)) os = "Windows";
  else if (mac) os = `macOS ${mac.replace(/_/g, ".")}`;
  else if (/CrOS/.test(clean)) os = "ChromeOS";
  else if (/Linux/.test(clean)) os = "Linux";

  let browser = "browser";
  const edge = pick(/(?:Edg|EdgA|EdgiOS)\/(\d+)/);
  const firefox = pick(/(?:Firefox|FxiOS)\/(\d+)/);
  const chrome = pick(/(?:Chrome|CriOS)\/(\d+)/);
  const samsung = pick(/SamsungBrowser\/(\d+)/);
  const safari = pick(/Version\/(\d+(?:\.\d+)?).*Safari/);
  if (edge) browser = `Edge ${edge}`;
  else if (samsung) browser = `Samsung Internet ${samsung}`;
  else if (firefox) browser = `Firefox ${firefox}`;
  else if (chrome) browser = `Chrome ${chrome}`;
  else if (safari) browser = `Safari ${safari}`;
  if (/FBAN|FBAV/.test(clean)) browser += " (Facebook app)";
  else if (/Instagram/.test(clean)) browser += " (Instagram app)";
  else if (/; wv\)/.test(clean)) browser += " (in-app)";

  const model = pick(/Android [^;)]*; ([^;)]+?)(?: Build|\))/);
  const device = /iPhone/.test(clean)
    ? "iPhone"
    : /iPad/.test(clean)
      ? "iPad"
      : model && model !== "K"
        ? model
        : null;
  return [device, os, browser].filter(Boolean).join(" · ").slice(0, 120);
}

// ─── rate limit ───────────────────────────────────────────────────────
export interface RateLimiter {
  allow(key: string): boolean;
}

/**
 * A small token bucket per key, kept in this server instance's memory. It is
 * a safety valve, not an exact quota: each serverless instance has its own
 * counts, so the fleet-wide ceiling is a few times `capacity`.
 */
export function createRateLimiter(options: {
  capacity: number;
  refillMs: number;
  maxKeys?: number;
  now?: () => number;
}): RateLimiter {
  const { capacity, refillMs, maxKeys = 2000, now = () => Date.now() } = options;
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    allow(key: string): boolean {
      const t = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxKeys) {
          // Drop the oldest key so memory stays bounded under a flood.
          buckets.delete(buckets.keys().next().value as string);
        }
        bucket = { tokens: capacity, at: t };
        buckets.set(key, bucket);
      }
      const refill = Math.floor((t - bucket.at) / refillMs);
      if (refill > 0) {
        bucket.tokens = Math.min(capacity, bucket.tokens + refill);
        bucket.at += refill * refillMs;
      }
      if (bucket.tokens <= 0) return false;
      bucket.tokens -= 1;
      return true;
    },
  };
}
