// Client wrapper. Submits the topic to POST /api/categories, then kicks
// off generation (POST /api/categories/[id]/generate) and routes to the
// pick screen. We do both in one click — the host's mental model is
// "type a topic → get 20 questions" — so we don't surface the intermediate
// "category created, now click generate" step.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HostGenTopicEntry, type DifficultyTarget } from "@/components/host/gen";
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

export interface HostSetupTopicClientProps {
  nightId: string;
  gameId: string;
  gameNo: number;
  position: number;
  themeKey: string;
  initialTopic?: string;
}

export function HostSetupTopicClient({
  nightId,
  gameId,
  gameNo,
  position,
  themeKey,
  initialTopic = "",
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
      const { category } = (await catRes.json()) as { category: { id: string } };

      // 2. Kick off generation. Idempotent on the server (claims/resumes the
      // existing job), so a retry never double-generates.
      const genRes = await postWithRetry(`/api/categories/${category.id}/generate`, {
        flavor: input.flavor.length > 0 ? input.flavor : undefined,
        difficulty: input.difficulty,
      });
      if (!genRes.ok && genRes.status !== 202) {
        const body = (await genRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not start generation");
      }

      try {
        window.sessionStorage.removeItem(draftKey);
      } catch {
        // Draft persistence is best-effort; a successful save must still navigate.
      }

      // 3. Hand off to the pick screen, which subscribes to the
      // generation progress channel.
      router.push(`/host/setup/${nightId}/pick/${category.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not pull questions.");
      setSubmitting(false);
    }
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
