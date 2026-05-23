// Client wrapper. Submits the topic to POST /api/categories, then kicks
// off generation (POST /api/categories/[id]/generate) and routes to the
// pick screen. We do both in one click — the host's mental model is
// "type a topic → get 20 questions" — so we don't surface the intermediate
// "category created, now click generate" step.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HostGenTopicEntry, type DifficultyTarget } from "@/components/host/gen";

export interface HostSetupTopicClientProps {
  nightId: string;
  gameId: string;
  gameNo: number;
  position: number;
}

export function HostSetupTopicClient({
  nightId,
  gameId,
  gameNo,
  position,
}: HostSetupTopicClientProps) {
  const router = useRouter();
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
      // 1. Create the category row.
      const catRes = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          name: input.topic,
          topic: input.topic,
          position,
        }),
      });
      if (!catRes.ok) {
        const body = (await catRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not create category");
      }
      const { category } = (await catRes.json()) as { category: { id: string } };

      // 2. Kick off generation.
      const genRes = await fetch(`/api/categories/${category.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flavor: input.flavor.length > 0 ? input.flavor : undefined,
          difficulty: input.difficulty,
        }),
      });
      if (!genRes.ok && genRes.status !== 202) {
        const body = (await genRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "could not start generation");
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
        shellTitle={`set up tonight · slot ${position}`}
        eyebrow={`GAME ${gameNo} · SLOT ${position} OF 6`}
        onSubmit={handleSubmit}
        isSubmitting={submitting}
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
