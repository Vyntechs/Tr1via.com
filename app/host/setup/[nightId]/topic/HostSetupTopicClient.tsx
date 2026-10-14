// Client wrapper. Submits the topic to POST /api/categories, then kicks
// off generation (POST /api/categories/[id]/generate) and routes to the
// pick screen. We do both in one click — the host's mental model is
// "type a topic → get 20 questions" — so we don't surface the intermediate
// "category created, now click generate" step.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  HostGenTopicEntry,
  type DifficultyTarget,
  type RecentTopic,
} from "@/components/host/gen";
import { Display, Eyebrow, ThemeProvider, useTheme } from "@/components/system";
import { LaptopShell } from "@/components/shells";
import { useMediaQuery } from "@/components/system/useMediaQuery";
import { fetchWithRetry } from "@/lib/realtime/fetchWithRetry";
import type { ThemeKey } from "@/lib/theme/tokens";

// Shown when the request can't reach the server after retries — actionable, and
// never the raw WebKit "Load failed". The create is idempotent, so retrying is
// safe and won't duplicate the topic.
const NETWORK_MESSAGE =
  "Couldn't reach the server. Check your connection and tap Pull 20 questions again.";

// POST that rides out a transient network drop (cellular / venue WiFi). Rethrows
// a friendly, actionable message when the network is exhausted; a completed HTTP
// response is returned for the caller to inspect (never retried).
async function postWithRetry(url: string, payload: unknown): Promise<Response> {
  try {
    return await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error(NETWORK_MESSAGE);
  }
}

export function slotTakenMessage(position: number, existingName: string | undefined): string {
  const label = existingName?.trim() ? `\u201c${existingName.trim()}\u201d` : "a topic";
  return `Slot ${position} already has ${label}. To change the topic, delete it on the setup screen first.`;
}

export interface HostSetupTopicClientProps {
  nightId: string;
  gameId: string;
  gameNo: number;
  position: number;
  themeKey: string;
  initialTopic?: string;
  /** The host's own topics from earlier nights. Empty → no chip row. */
  recent?: RecentTopic[];
  /**
   * The category already in this slot. Set when she reaches the form from an
   * old setup screen or a second device: she gets a plain notice and a way to
   * open it or go back and delete it, never a second topic form.
   */
  takenBy?: { id: string; name: string } | null;
}

export function HostSetupTopicClient({
  nightId,
  gameId,
  gameNo,
  position,
  themeKey,
  initialTopic = "",
  recent = [],
  takenBy = null,
}: HostSetupTopicClientProps) {
  const router = useRouter();
  const draftKey = `host-topic:${nightId}:${gameId}:${position}`;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(input: {
    topic: string;
    difficulty: DifficultyTarget;
    flavor: string[];
  }) {
    setSubmitting(true);
    setError(null);
    try {
      // 1. Create the category row. Idempotent get-or-create, so a retried
      // request after a dropped connection reuses the same slot.
      const catRes = await postWithRetry("/api/categories", {
        gameId,
        name: input.topic,
        topic: input.topic,
        position,
      });
      if (!catRes.ok) {
        const body = (await catRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not create category");
      }
      const { category, reused, sameTopic } = (await catRes.json()) as {
        category: { id: string; name?: string; state?: string };
        reused?: boolean;
        sameTopic?: boolean;
      };

      // This slot already holds a different topic (she came back to this form
      // with the browser Back button, from an old setup screen, or from a
      // second device). The server kept the slot to one category; say so
      // instead of quietly opening the old topic or starting a second one.
      if (reused && sameTopic === false) {
        throw new Error(slotTakenMessage(position, category.name));
      }

      // 2. Kick off generation. Idempotent on the server (claims/resumes the
      // existing job), so a retry never double-generates. A slot that already
      // has its questions (review) or is locked (ready) is left alone: the
      // same words typed again just open it.
      const alreadyBuilt =
        reused && (category.state === "review" || category.state === "ready");
      if (!alreadyBuilt) {
        const genRes = await postWithRetry(`/api/categories/${category.id}/generate`, {
          flavor: input.flavor.length > 0 ? input.flavor : undefined,
          difficulty: input.difficulty,
        });
        if (!genRes.ok && genRes.status !== 202) {
          const body = (await genRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "could not start generation");
        }
      }

      try {
        window.sessionStorage.removeItem(draftKey);
      } catch {
        // Draft persistence is best-effort; a successful save must still navigate.
      }

      // 3. Hand off to the pick screen, which subscribes to the
      // generation progress channel. `replace`, not `push`: the topic form
      // leaves the history, so Back from the pick screen returns to the setup
      // screen instead of a blank form for a slot that is now filled.
      router.replace(`/host/setup/${nightId}/pick/${category.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pull questions.");
      setSubmitting(false);
    }
  }

  if (takenBy) {
    return (
      <ThemeProvider themeKey={themeKey as ThemeKey}>
        <SlotTakenNotice
          gameNo={gameNo}
          position={position}
          name={takenBy.name}
          onOpen={() => router.replace(`/host/setup/${nightId}/pick/${takenBy.id}`)}
          onBack={() => router.replace(`/host/setup/${nightId}`)}
        />
      </ThemeProvider>
    );
  }

  return (
    <>
      <HostGenTopicEntry
        themeKey={themeKey as ThemeKey}
        shellTitle={`set up tonight · slot ${position}`}
        eyebrow={`GAME ${gameNo} · SLOT ${position} OF 6`}
        onSubmit={handleSubmit}
        isSubmitting={submitting}
        initialTopic={initialTopic}
        draftKey={draftKey}
        recent={recent}
      />
      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 50,
            padding: "12px 16px",
            borderRadius: 10,
            background: "rgba(156,47,47,.95)",
            color: "#FFF",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          {error}
        </div>
      )}
    </>
  );
}

// Shown in place of the topic form when the slot is already filled. Two ways
// on: open what is there, or go back to the setup screen, where every slot has
// its delete button. Nothing here deletes anything.
function SlotTakenNotice({
  gameNo,
  position,
  name,
  onOpen,
  onBack,
}: {
  gameNo: number;
  position: number;
  name: string;
  onOpen: () => void;
  onBack: () => void;
}) {
  const { t } = useTheme();
  const mobile = useMediaQuery("(max-width: 860px)");
  const label = name.trim() || "this category";
  const buttonBase = {
    flex: mobile ? "1 1 100%" : "1 1 220px",
    minHeight: mobile ? 52 : undefined,
    padding: "14px 22px",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: 700,
    fontFamily: "var(--font-sans)",
    cursor: "pointer",
  } as const;
  return (
    <LaptopShell>
      <div
        data-host-mobile-surface="true"
        style={{
          flex: 1,
          padding: mobile ? "24px 16px max(24px, env(safe-area-inset-bottom))" : "56px 56px 40px",
          display: "flex",
          alignItems: mobile ? "flex-start" : "center",
          justifyContent: "center",
        }}
      >
        <div
          role="status"
          data-testid="slot-taken-notice"
          style={{ width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", gap: 18 }}
        >
          <Eyebrow color={t.accent} size={11}>
            {`GAME ${gameNo} · SLOT ${position} OF 6`}
          </Eyebrow>
          <Display size={mobile ? 32 : 42} color={t.ink} tracking={-0.03} style={{ display: "block" }}>
            This slot is already set up.
          </Display>
          <p style={{ margin: 0, color: t.ink, fontSize: 15, lineHeight: 1.55, fontWeight: 500 }}>
            {slotTakenMessage(position, name)}
          </p>
          <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onOpen}
              style={{
                ...buttonBase,
                border: "none",
                background: t.accent,
                color: "#FFF",
                boxShadow: `0 12px 26px -12px ${t.accent}88`,
              }}
            >
              {`Open \u201c${label}\u201d`}
            </button>
            <button
              type="button"
              onClick={onBack}
              style={{
                ...buttonBase,
                border: `1px solid ${t.line}`,
                background: "transparent",
                color: t.ink,
              }}
            >
              Back to setup
            </button>
          </div>
        </div>
      </div>
    </LaptopShell>
  );
}
