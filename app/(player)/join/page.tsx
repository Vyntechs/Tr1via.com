// Player JOIN entry surface.
//
// Two sub-modes selected by the URL:
//   - No `?code=` → show the typed-code input + scan instructions. The
//     player either scans the QR on the TV (which lands them on
//     /join?code=XXXXXX directly) or types the code shown on the TV. Once
//     valid, we forward to /join?code=XXXXXX.
//   - With `?code=` → look up the night via GET /api/nights/by-code. If the
//     room is real and open, render `<PlayerJoin>` wrapped in the night's
//     theme; submit posts to /api/players. On success we forward to
//     /room/[code]. If the code is bad we surface "Room not found" inline.
//
// We always boot the device session up front (so the cookie exists before
// the player taps "Join the room"; otherwise POST /api/players returns 401).

"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PlayerJoin } from "@/components/player";
import {
  ThemeProvider,
  useTheme,
  Wordmark,
  Display,
  Eyebrow,
} from "@/components/system";
import { PhoneScreen, PhoneHeader } from "@/components/shells";
import { useDeviceSession } from "@/lib/hooks/useDeviceSession";
import {
  formatRoomCode,
  isValidRoomCode,
  parseRoomCode,
} from "@/lib/game/room-code";
import { isThemeKey, type ThemeKey } from "@/lib/theme/tokens";

interface NightLookup {
  nightId: string;
  venueName: string;
  themeKey: string;
  isLocked: boolean;
  isOpen: boolean;
}

type LookupState =
  | { kind: "loading" }
  | { kind: "ok"; night: NightLookup }
  | { kind: "error"; message: string };

export default function PlayerJoinPage() {
  // Next requires anything calling useSearchParams() to be wrapped in a
  // Suspense boundary at build/SSG time. We pre-paint the static code-entry
  // screen as the fallback so the surface never goes blank.
  return (
    <Suspense fallback={<CodeEntryScreen onSubmit={() => undefined} />}>
      <JoinPageInner />
    </Suspense>
  );
}

function JoinPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const rawCode = params.get("code");
  const code = rawCode ? parseRoomCode(rawCode) : null;
  const hasValidCode = code !== null && isValidRoomCode(code);

  if (!hasValidCode) {
    return <CodeEntryScreen onSubmit={(c) => router.push(`/join?code=${c}`)} />;
  }
  return <JoinWithCode roomCode={code} />;
}

// ─── No-code state: type/scan a room code ────────────────────────────────

function CodeEntryScreen({ onSubmit }: { onSubmit: (code: string) => void }) {
  // Theme is the global default ("house") since we don't know the night yet.
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow="JOIN A ROOM" />
      <CodeEntryBody onSubmit={onSubmit} />
    </PhoneScreen>
  );
}

function CodeEntryBody({ onSubmit }: { onSubmit: (code: string) => void }) {
  const { t } = useTheme();
  const [raw, setRaw] = useState("");
  const parsed = parseRoomCode(raw);
  const valid = isValidRoomCode(parsed);

  function handleSubmit(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    if (!valid) return;
    onSubmit(parsed);
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
    >
      <div style={{ paddingTop: 24, flex: 1, display: "flex", flexDirection: "column" }}>
        <Wordmark size={32} />
        <Display
          size={52}
          color={t.ink}
          style={{ marginTop: 22, display: "block" }}
          tracking={-0.035}
        >
          Got a code?
          <br />
          <span style={{ color: t.accent }}>You&apos;re in.</span>
        </Display>
        <p
          style={{
            marginTop: 16,
            color: t.inkMid,
            fontSize: 14.5,
            lineHeight: 1.45,
            maxWidth: 300,
          }}
        >
          Type the 6-character room code from the TV. The middle dot is
          optional — punctuation, case, and spaces don&apos;t matter.
        </p>

        <div style={{ marginTop: 36 }}>
          <Eyebrow color={t.inkMid} size={10}>ROOM CODE</Eyebrow>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value.slice(0, 10))}
            placeholder="K9P · R4M"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            aria-label="Room code"
            style={{
              marginTop: 10,
              width: "100%",
              boxSizing: "border-box",
              padding: "16px 18px",
              fontFamily: "var(--font-mono)",
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: t.ink,
              background: t.surface,
              border: `1.5px solid ${valid ? t.accent : t.line}`,
              borderRadius: 14,
              outline: "none",
            }}
          />
          <div style={{ marginTop: 8, color: t.inkMute, fontSize: 12 }}>
            {valid
              ? `${formatRoomCode(parsed)} — looks good.`
              : "Six characters, no zero or 1."}
          </div>
        </div>

        <div
          style={{
            marginTop: 28,
            padding: "14px 16px",
            borderRadius: 12,
            background: t.surface,
            color: t.inkMid,
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <Eyebrow color={t.inkMid} size={10}>OR · SCAN THE QR</Eyebrow>
          <div style={{ marginTop: 4 }}>
            Point your camera at the QR on the TV — you&apos;ll skip this
            screen entirely.
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={!valid}
        style={{
          marginTop: "auto",
          background: t.accent,
          color: "#FFF",
          border: "none",
          borderRadius: 14,
          padding: "20px 0",
          fontSize: 17,
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          cursor: valid ? "pointer" : "default",
          opacity: valid ? 1 : 0.55,
          boxShadow: `0 14px 30px -10px ${t.accent}66`,
        }}
      >
        Find the room  →
      </button>
    </form>
  );
}

// ─── With-code state: look up the night, then show PlayerJoin ────────────

function JoinWithCode({ roomCode }: { roomCode: string }) {
  const router = useRouter();
  const { deviceId, isLoading: deviceLoading } = useDeviceSession();
  const [lookup, setLookup] = useState<LookupState>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Used to keep the input value across re-renders of <PlayerJoin>; on a
  // server bounce we want to remember what the player typed.
  const lastNameRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;
    setLookup({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch(`/api/nights/by-code/${roomCode}`);
        if (cancelled) return;
        if (res.status === 404) {
          setLookup({ kind: "error", message: "Room not found." });
          return;
        }
        if (!res.ok) {
          setLookup({ kind: "error", message: `Lookup failed (${res.status}).` });
          return;
        }
        const data = (await res.json()) as NightLookup;
        setLookup({ kind: "ok", night: data });
      } catch (e) {
        if (cancelled) return;
        setLookup({
          kind: "error",
          message: e instanceof Error ? e.message : "Network error.",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomCode]);

  async function handleSubmit(displayName: string) {
    if (lookup.kind !== "ok") return;
    if (!deviceId) {
      setSubmitError("Setting up your device session — try again in a moment.");
      return;
    }
    lastNameRef.current = displayName;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/players", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nightId: lookup.night.nightId,
          displayName,
        }),
      });
      if (!res.ok) {
        const body = await safeJson(res);
        setSubmitError(extractMessage(body, res.status));
        return;
      }
      router.push(`/room/${roomCode}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  }

  // Lookup in flight — show neutral placeholder using the global theme so we
  // don't flash colors.
  if (lookup.kind === "loading" || deviceLoading) {
    return <NeutralLoading roomCode={roomCode} />;
  }
  if (lookup.kind === "error") {
    return <NotFoundScreen roomCode={roomCode} message={lookup.message} />;
  }

  const themeKey: ThemeKey = isThemeKey(lookup.night.themeKey)
    ? lookup.night.themeKey
    : "house";

  if (lookup.night.isLocked) {
    return (
      <ThemeProvider themeKey={themeKey}>
        <NotFoundScreen
          roomCode={roomCode}
          message="This room is locked — ask the host to open it."
        />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider themeKey={themeKey}>
      <PlayerJoin
        themeKey={themeKey}
        venueName={lookup.night.venueName}
        playerName={lastNameRef.current || ""}
        onSubmit={handleSubmit}
        submitting={submitting}
        error={submitError}
      />
    </ThemeProvider>
  );
}

function NeutralLoading({ roomCode }: { roomCode: string }) {
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow={`JOINING · ${formatRoomCode(roomCode)}`} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Eyebrow color={t.inkMid} size={11}>HOLD ON</Eyebrow>
        <Display size={48} color={t.ink}>
          Finding
          <br />
          <span style={{ color: t.accent }}>your room…</span>
        </Display>
      </div>
    </PhoneScreen>
  );
}

function NotFoundScreen({
  roomCode,
  message,
}: {
  roomCode: string;
  message: string;
}) {
  const router = useRouter();
  const { t } = useTheme();
  return (
    <PhoneScreen>
      <PhoneHeader eyebrow={`ROOM · ${formatRoomCode(roomCode)}`} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", paddingTop: 24 }}>
        <Wordmark size={28} />
        <Display
          size={52}
          color={t.ink}
          style={{ marginTop: 24, display: "block" }}
        >
          <span style={{ color: t.wrong }}>Hmm.</span>
          <br />
          {message}
        </Display>
        <p
          style={{
            marginTop: 18,
            color: t.inkMid,
            fontSize: 14.5,
            lineHeight: 1.45,
            maxWidth: 300,
          }}
        >
          Double-check the 6-character code on the TV — the middle character
          might be a 0 (zero) or 1 that this game doesn&apos;t use.
        </p>
      </div>
      <button
        type="button"
        onClick={() => router.push("/join")}
        style={{
          marginTop: "auto",
          background: t.accent,
          color: "#FFF",
          border: "none",
          borderRadius: 14,
          padding: "18px 0",
          fontSize: 16,
          fontWeight: 700,
          fontFamily: "var(--font-sans)",
          cursor: "pointer",
          boxShadow: `0 14px 30px -10px ${t.accent}66`,
        }}
      >
        Try a different code
      </button>
    </PhoneScreen>
  );
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function extractMessage(body: unknown, status: number): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof (body as { error?: unknown }).error === "string"
  ) {
    return (body as { error: string }).error;
  }
  if (status === 403) return "This room isn't accepting players right now.";
  if (status === 401) return "Couldn't verify your device — refresh and try again.";
  if (status === 404) return "Room not found.";
  return `Couldn't join (status ${status}).`;
}
