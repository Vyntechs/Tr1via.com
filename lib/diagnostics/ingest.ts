// Intake rules for device reports (POST /api/diag/report).
//
// Pure functions, no I/O, so the size / shape / rate limits are easy to test.
// Nothing a device sends is trusted: the batch is rebuilt field by field, and
// EVERY event kind is rebuilt from a fixed list of fields (DIAG_EVENT_FIELDS
// below). A field that is not on the list is thrown away. A number is rounded
// and clamped to its range, text must be one of a few fixed words, and the only
// free text left (a few short names such as an error name or a path) may only
// use letters, digits and a few separators and is cut to 40 characters.

import {
  DIAG_DEVICE_CLASSES,
  DIAG_DEVICE_KINDS,
  DIAG_MAX_EVENTS_PER_BATCH,
  DIAG_SCREEN_CLASSES,
  DIAG_SURFACE_KINDS,
  DIAG_SURFACES,
  type DiagDeviceKind,
  type DiagSurface,
} from "./config";

export type DiagValue = string | number | boolean;

export interface CleanEvent {
  /** Device clock, ms since epoch. */
  t: number;
  k: DiagDeviceKind;
  d: Record<string, DiagValue>;
  forced: boolean;
}

export interface CleanBatch {
  surface: DiagSurface;
  /** Room code (phones). */
  room: string | null;
  /** Night id (host laptop / phone only). */
  night: string | null;
  /** The signed pass the server gave the TV page (TV only). */
  pass: string | null;
  sid: string;
  /** Device clock when the batch was sent, ms since epoch. */
  sentAt: number;
  events: CleanEvent[];
}

const KIND_SET = new Set<string>(DIAG_DEVICE_KINDS);
const SURFACE_SET = new Set<string>(DIAG_SURFACES);
const SID_RE = /^[A-Za-z0-9_-]{6,48}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_RE = /^[A-Za-z0-9·.\- ]{4,12}$/;
const PASS_RE = /^[A-Za-z0-9._-]{20,200}$/;
// An event older than this when the batch is sent, or from the future, is junk.
const MAX_AGE_MS = 30 * 60_000;
const MAX_FUTURE_MS = 60_000;
const MIN_EPOCH_MS = 1_577_836_800_000; // 2020-01-01
const MAX_EPOCH_MS = 4_102_444_800_000; // 2100-01-01

// ─── the fixed list of fields, by event kind ─────────────────────────
type FieldSpec =
  /** A number, rounded to `decimals` places and clamped. `words`: or one of these words. */
  | { t: "num"; min: number; max: number; decimals?: number; words?: readonly string[] }
  | { t: "bool" }
  /** Exactly one of these words. */
  | { t: "enum"; values: readonly string[] }
  /** The little free text there is: letters, digits and `_ - . : / space`, at most `max` (40) long. */
  | { t: "word"; max: number }
  | { t: "uuid" };

const EFFECTIVE_TYPES = ["slow-2g", "2g", "3g", "4g"] as const;
const MEDIA = ["bluetooth", "cellular", "ethernet", "none", "wifi", "wimax", "other", "unknown"] as const;
const NET_EVENTS = ["online", "offline", "conn"] as const;
const RIBBON_STATES = ["online", "backup", "reconnecting", "unreachable", "offline"] as const;
const REACH_STATES = ["ok", "unreachable"] as const;

const connection = {
  et: { t: "enum", values: EFFECTIVE_TYPES },
  ty: { t: "enum", values: MEDIA },
  rtt: { t: "num", min: 0, max: 60_000 },
  dl: { t: "num", min: 0, max: 10_000, decimals: 1 },
} satisfies Record<string, FieldSpec>;

/**
 * Everything a device may say, by event kind. The names are the ones the
 * device code sends (see lib/diagnostics/client.ts, reporter.ts and the hooks
 * that call it). Nothing else is ever stored.
 */
export const DIAG_EVENT_FIELDS: Record<DiagDeviceKind, Record<string, FieldSpec>> = {
  // what the device is (the server adds browser, OS family and device class itself)
  device: {
    sc: { t: "enum", values: DIAG_SCREEN_CLASSES },
    ol: { t: "bool" },
    rm: { t: "bool" },
    theme: { t: "word", max: 24 },
    ...connection,
  },
  net: { ev: { t: "enum", values: NET_EVENTS }, ol: { t: "bool" }, ...connection },
  vis: { ev: { t: "enum", values: ["hidden", "visible"] } },
  // a game-change broadcast was heard: which one, the server's send time, how late
  bcast: {
    ev: { t: "word", max: 40 },
    srv: { t: "num", min: MIN_EPOCH_MS, max: MAX_EPOCH_MS },
    lag: { t: "num", min: -1_000_000_000, max: 1_000_000_000 },
  },
  // a room re-download: which one, how long, did it work, tries, why not
  snap: {
    w: { t: "word", max: 40 },
    ms: { t: "num", min: 0, max: 3_600_000 },
    ok: { t: "bool" },
    n: { t: "num", min: 0, max: 50 },
    err: { t: "word", max: 40 },
  },
  // another API call that was slow or failed: which, how long, first byte, status
  res: {
    p: { t: "word", max: 40 },
    ms: { t: "num", min: 0, max: 3_600_000 },
    ttfb: { t: "num", min: 0, max: 3_600_000 },
    st: { t: "num", min: 0, max: 999 },
  },
  ribbon: {
    from: { t: "enum", values: ["start", ...RIBBON_STATES] },
    to: { t: "enum", values: RIBBON_STATES },
    chan: { t: "word", max: 24 },
    reach: { t: "enum", values: REACH_STATES },
    bk: { t: "bool" },
    ol: { t: "bool" },
  },
  chan: { from: { t: "word", max: 24 }, to: { t: "word", max: 24 } },
  reach: { from: { t: "enum", values: REACH_STATES }, to: { t: "enum", values: REACH_STATES } },
  // an answer tap as the phone saw it
  tap: {
    q: { t: "uuid" },
    slot: { t: "num", min: 0, max: 4 },
    tries: { t: "num", min: 0, max: 99 },
    ms: { t: "num", min: 0, max: 3_600_000 },
    ok: { t: "bool" },
    st: { t: "num", min: 0, max: 999, words: ["network"] },
    rs: { t: "bool" },
  },
  // a tap the phone ignored because its question had closed
  tapx: {
    q: { t: "uuid" },
    slot: { t: "num", min: 0, max: 4 },
    why: { t: "enum", values: ["closed"] },
  },
  // main-thread stalls in the last window
  lt: {
    n: { t: "num", min: 0, max: 100_000 },
    max: { t: "num", min: 0, max: 600_000 },
    sum: { t: "num", min: 0, max: 60_000_000 },
    win: { t: "num", min: 0, max: 3_600_000 },
  },
  // TV scene frame rate
  fps: {
    scene: { t: "word", max: 24 },
    fps: { t: "num", min: 0, max: 240, decimals: 1 },
    slow: { t: "num", min: 0, max: 1000 },
    worst: { t: "num", min: 0, max: 60_000 },
    n: { t: "num", min: 0, max: 1000 },
  },
};

const WORD_RE = /^[A-Za-z0-9_ .:/-]+$/;

function cleanField(spec: FieldSpec, value: unknown): DiagValue | undefined {
  switch (spec.t) {
    case "bool":
      return typeof value === "boolean" ? value : undefined;
    case "enum":
      return typeof value === "string" && spec.values.includes(value) ? value : undefined;
    case "uuid":
      return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : undefined;
    case "word": {
      if (typeof value !== "string") return undefined;
      const text = value.slice(0, spec.max);
      return text.length > 0 && WORD_RE.test(text) ? text : undefined;
    }
    case "num": {
      if (typeof value === "string" && spec.words?.includes(value)) return value;
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      const scale = 10 ** (spec.decimals ?? 0);
      return Math.round(Math.min(spec.max, Math.max(spec.min, value)) * scale) / scale;
    }
  }
}

/** Rebuild an event's data from the fixed list for its kind. Unknown fields are thrown away. */
export function cleanEventFields(kind: DiagDeviceKind, raw: unknown): Record<string, DiagValue> {
  const r = asRecord(raw);
  const out: Record<string, DiagValue> = {};
  for (const [name, spec] of Object.entries(DIAG_EVENT_FIELDS[kind])) {
    if (!Object.prototype.hasOwnProperty.call(r, name)) continue;
    const clean = cleanField(spec, r[name]);
    if (clean !== undefined) out[name] = clean;
  }
  return out;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** The `device` event as stored (the browser, OS and device class are added from the request). */
export function cleanDeviceData(raw: unknown): Record<string, DiagValue> {
  return cleanEventFields("device", raw);
}

/** A `net` event as stored: what changed, and the connection type after it. */
export function cleanNetData(raw: unknown): Record<string, DiagValue> {
  return cleanEventFields("net", raw);
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

  // Who the batch is about depends on the screen: a phone names its room, the
  // host names its night, the TV carries the signed pass the server gave it
  // (it names nothing itself). Anything a surface should not send is ignored.
  const room = surface === "player" && typeof body.room === "string" && ROOM_RE.test(body.room) ? body.room : null;
  const night = surface === "host" && typeof body.night === "string" && UUID_RE.test(body.night) ? body.night : null;
  const pass = surface === "tv" && typeof body.tok === "string" && PASS_RE.test(body.tok) ? body.tok : null;
  if (!room && !night && !pass) return null;

  const allowedKinds = new Set<string>(DIAG_SURFACE_KINDS[surface as DiagSurface]);
  const list = Array.isArray(body.ev) ? body.ev.slice(0, DIAG_MAX_EVENTS_PER_BATCH) : [];
  const events: CleanEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e.k !== "string" || !KIND_SET.has(e.k) || !allowedKinds.has(e.k)) continue;
    if (typeof e.t !== "number" || !Number.isFinite(e.t)) continue;
    const age = sentAt - e.t;
    if (age > MAX_AGE_MS || age < -MAX_FUTURE_MS) continue;
    const kind = e.k as DiagDeviceKind;
    events.push({
      t: Math.round(e.t),
      k: kind,
      d: cleanEventFields(kind, e.d),
      forced: e.f === 1 || e.f === true,
    });
  }
  return { surface: surface as DiagSurface, room, night, pass, sid, sentAt, events };
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
