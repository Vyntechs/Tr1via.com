// Intake rules for device reports (POST /api/diag/report).
//
// Pure functions, no I/O, so the size / shape / rate limits are easy to test.
// Nothing a device sends is trusted: the batch is rebuilt field by field from
// an allowlist, every number and string is bounded, and anything unexpected
// is dropped rather than stored.

import {
  DIAG_DEVICE_CLASSES,
  DIAG_DEVICE_KINDS,
  DIAG_MAX_EVENTS_PER_BATCH,
  DIAG_MAX_EVENT_BYTES,
  DIAG_SCREEN_CLASSES,
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
      // What a device says about ITSELF is rebuilt from a fixed list of keys
      // (see DIAG_DEVICE_KEYS in config.ts); everything else is bounded
      // generically.
      d: e.k === "device" ? cleanDeviceData(e.d) : e.k === "net" ? cleanNetData(e.d) : cleanEventData(e.d),
      forced: e.f === 1 || e.f === true,
    });
  }
  return { surface: surface as DiagSurface, room, night, sid, sentAt, events };
}

// ─── what the device says about itself: a fixed list of keys ─────────
const SCREEN_SET = new Set<string>(DIAG_SCREEN_CLASSES);
const EFFECTIVE_TYPES = new Set(["slow-2g", "2g", "3g", "4g"]);
const MEDIA = new Set(["bluetooth", "cellular", "ethernet", "none", "wifi", "wimax", "other", "unknown"]);
const NET_EVENTS = new Set(["online", "offline", "conn"]);
const THEME_RE = /^[a-z0-9_-]{1,24}$/i;

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function connectionFields(raw: Record<string, unknown>): Record<string, DiagValue> {
  const out: Record<string, DiagValue> = {};
  if (typeof raw.et === "string" && EFFECTIVE_TYPES.has(raw.et)) out.et = raw.et;
  if (typeof raw.ty === "string" && MEDIA.has(raw.ty)) out.ty = raw.ty;
  if (typeof raw.rtt === "number" && Number.isFinite(raw.rtt) && raw.rtt >= 0 && raw.rtt <= 60_000) {
    out.rtt = Math.round(raw.rtt);
  }
  if (typeof raw.dl === "number" && Number.isFinite(raw.dl) && raw.dl >= 0 && raw.dl <= 10_000) {
    out.dl = Math.round(raw.dl * 10) / 10;
  }
  return out;
}

/**
 * The `device` event as stored: connection type, coarse screen class,
 * online / reduce-motion flags and the theme. The browser, OS and device class
 * are added by the server from the request itself (summarizeDevice), never
 * taken from the body, so a device cannot claim anything else here.
 */
export function cleanDeviceData(raw: unknown): Record<string, DiagValue> {
  const r = asRecord(raw);
  const out: Record<string, DiagValue> = {};
  if (typeof r.sc === "string" && SCREEN_SET.has(r.sc)) out.sc = r.sc;
  if (typeof r.ol === "boolean") out.ol = r.ol;
  if (typeof r.rm === "boolean") out.rm = r.rm;
  if (typeof r.theme === "string" && THEME_RE.test(r.theme)) out.theme = r.theme;
  return { ...out, ...connectionFields(r) };
}

/** A `net` event as stored: what changed, and the connection type after it. */
export function cleanNetData(raw: unknown): Record<string, DiagValue> {
  const r = asRecord(raw);
  const out: Record<string, DiagValue> = {};
  if (typeof r.ev === "string" && NET_EVENTS.has(r.ev)) out.ev = r.ev;
  if (typeof r.ol === "boolean") out.ol = r.ol;
  return { ...out, ...connectionFields(r) };
}

// ─── a short description of the device, from the request ─────────────
export interface DeviceSummary {
  /** Browser family and major version, e.g. "Safari 17". */
  br: string;
  /** Operating-system family only, e.g. "iOS". */
  os: string;
  /** phone, tablet, laptop, tv (or unknown when there is no browser text). */
  dc: (typeof DIAG_DEVICE_CLASSES)[number];
}

/**
 * Reads the browser text once, keeps three short words, and throws the rest
 * away. The raw text, the phone model and the OS version are never stored.
 */
export function summarizeDevice(ua: string | null | undefined, surface: DiagSurface): DeviceSummary {
  if (!ua) return { br: "unknown", os: "unknown", dc: surface === "tv" ? "tv" : "unknown" };
  const clean = ua.replace(/[\u0000-\u001f\u007f]/g, "");
  const pick = (re: RegExp) => re.exec(clean)?.[1];

  let os = "other";
  if (/iPad/.test(clean)) os = "iPadOS";
  else if (/iPhone|iPod/.test(clean)) os = "iOS";
  else if (/Android/.test(clean)) os = "Android";
  else if (/CrOS/.test(clean)) os = "ChromeOS";
  else if (/Windows NT/.test(clean)) os = "Windows";
  else if (/Macintosh|Mac OS X/.test(clean)) os = "macOS";
  else if (/Linux/.test(clean)) os = "Linux";

  let br = "other";
  const edge = pick(/(?:Edg|EdgA|EdgiOS)\/(\d+)/);
  const samsung = pick(/SamsungBrowser\/(\d+)/);
  const firefox = pick(/(?:Firefox|FxiOS)\/(\d+)/);
  const opera = pick(/OPR\/(\d+)/);
  const chrome = pick(/(?:Chrome|CriOS)\/(\d+)/);
  const safari = pick(/Version\/(\d+).*Safari/);
  if (edge) br = `Edge ${edge}`;
  else if (samsung) br = `Samsung Internet ${samsung}`;
  else if (firefox) br = `Firefox ${firefox}`;
  else if (opera) br = `Opera ${opera}`;
  else if (chrome) br = `Chrome ${chrome}`;
  else if (safari) br = `Safari ${safari}`;
  // Pages opened inside another app are slower to wake up and are worth telling apart.
  if (/FBAN|FBAV/.test(clean)) br += " (Facebook app)";
  else if (/Instagram/.test(clean)) br += " (Instagram app)";
  else if (/; wv\)/.test(clean)) br += " (in-app)";

  let dc: DeviceSummary["dc"];
  if (surface === "tv" || /SmartTV|SMART-TV|Tizen|Web0S|WebOS|HbbTV|BRAVIA|CrKey|AppleTV|Roku/i.test(clean)) dc = "tv";
  else if (/iPad|Tablet/.test(clean)) dc = "tablet";
  else if (/iPhone|iPod/.test(clean)) dc = "phone";
  else if (/Android/.test(clean)) dc = /Mobile/.test(clean) ? "phone" : "tablet";
  else dc = "laptop";
  return { br: br.slice(0, 40), os, dc };
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
