// tr1via.com — the public landing.
//
// 90% of visitors are players: the host tells them "go to tr1via.com" while
// pointing at the TV. So the landing IS the room-code entry. Type a valid
// code → router-push to /join?code=XXX, where the existing flow takes over
// (night lookup → themed PlayerJoin → POST /api/players → /room/[code]).
//
// The 10% who are hosts get a small chip in the top-right that routes to
// /login. The dev galleries (/dev) are intentionally not linked from here;
// they're internal.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  Wordmark,
  Display,
  Eyebrow,
  useTheme,
} from "@/components/system";
import {
  formatRoomCode,
  isValidRoomCode,
  parseRoomCode,
} from "@/lib/game/room-code";

export default function HomePage() {
  const { t } = useTheme();
  const router = useRouter();
  const [raw, setRaw] = useState("");
  const parsed = parseRoomCode(raw);
  const valid = isValidRoomCode(parsed);

  function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!valid) return;
    router.push(`/join?code=${parsed}`);
  }

  return (
    <main
      data-testid="home"
      style={{
        minHeight: "100dvh",
        background: t.paper,
        color: t.ink,
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        padding: "24px clamp(20px, 5vw, 56px)",
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <Wordmark size={28} />
        <Link
          href="/login"
          data-testid="home-host-signin"
          style={{
            color: t.inkMid,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            textDecoration: "none",
            fontWeight: 600,
            padding: "8px 14px",
            border: `1px solid ${t.line}`,
            borderRadius: 999,
            background: t.surface,
          }}
        >
          Host · Sign in  →
        </Link>
      </header>

      <section
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 0",
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{
            width: "100%",
            maxWidth: 440,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Eyebrow color={t.accent} size={11}>JOIN THE ROOM</Eyebrow>
          <Display
            size={68}
            color={t.ink}
            tracking={-0.04}
            style={{ marginTop: 14, lineHeight: 0.95, display: "block" }}
          >
            Got a code?
            <br />
            <span style={{ color: t.accent }}>You&apos;re in.</span>
          </Display>
          <p
            style={{
              marginTop: 18,
              color: t.inkMid,
              fontSize: 15,
              lineHeight: 1.5,
              maxWidth: 360,
            }}
          >
            Live trivia, designed to make the room feel alive. Type the
            6-character room code from the TV — or point your camera at the QR.
          </p>

          <div style={{ marginTop: 32 }}>
            <Eyebrow color={t.inkMid} size={10}>ROOM CODE</Eyebrow>
            <input
              value={raw}
              onChange={(e) => setRaw(e.target.value.slice(0, 10))}
              placeholder="K9P · R4M"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              aria-label="Room code"
              data-testid="home-room-code-input"
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

          <button
            type="submit"
            disabled={!valid}
            data-testid="home-find-room-btn"
            style={{
              marginTop: 24,
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
      </section>

      <footer
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          color: t.inkMute,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        <span>tr1via.com</span>
        <span>Live trivia</span>
      </footer>
    </main>
  );
}
