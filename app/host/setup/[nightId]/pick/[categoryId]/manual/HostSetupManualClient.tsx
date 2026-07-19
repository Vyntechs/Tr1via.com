// Manual-entry client wrapper. Owns the submit handler that POSTs to
// /api/categories/[id]/manual and then returns the host to the setup
// overview when she's done.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  HostGenManualEntry,
  type HostGenManualQuestionInput,
} from "@/components/host/gen";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface HostSetupManualClientProps {
  nightId: string;
  categoryId: string;
  categoryName: string;
  categoryTopic: string;
  themeKey: string;
}

export function HostSetupManualClient({
  nightId,
  categoryId,
  categoryName,
  categoryTopic,
  themeKey,
}: HostSetupManualClientProps) {
  const router = useRouter();
  const draftKey = `host-manual:${nightId}:${categoryId}`;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(questions: HostGenManualQuestionInput[]) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/categories/${categoryId}/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questions: questions.map((q) => ({
            prompt: q.prompt,
            options: q.options,
            correctIndex: q.correctIndex,
            imageUrl: q.imageUrl,
          })),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Could not save your questions.");
      }
      try {
        window.sessionStorage.removeItem(draftKey);
      } catch {
        // Draft persistence is best-effort; a successful save must still navigate.
      }
      router.push(`/host/setup/${nightId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
      setSubmitting(false);
    }
  }

  return (
    <HostGenManualEntry
      themeKey={themeKey as ThemeKey}
      shellTitle={`type 7 · ${categoryName.toLowerCase()}`}
      topic={categoryTopic || categoryName}
      eyebrow={`${categoryName.toUpperCase()} · MANUAL ENTRY · 7 QUESTIONS`}
      onSubmit={(qs) => void handleSubmit(qs)}
      onCancel={() =>
        router.push(`/host/setup/${nightId}/pick/${categoryId}`)
      }
      isSubmitting={submitting}
      errorMessage={error}
      draftKey={draftKey}
    />
  );
}
