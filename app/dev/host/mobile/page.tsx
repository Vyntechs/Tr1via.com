"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  HostGenEdit,
  HostGenImageSwap,
  HostGenImageUpload,
  HostGenLoading,
  HostGenManualEntry,
  HostGenOverview,
  HostGenPick,
  HostGenTopicEntry,
} from "@/components/host/gen";

const SURFACES = [
  "overview",
  "topic",
  "loading",
  "pick",
  "edit",
  "image-swap",
  "image-upload",
  "manual",
] as const;
type Surface = (typeof SURFACES)[number];

export default function HostMobilePreviewPage() {
  return (
    <Suspense fallback={null}>
      <HostMobilePreview />
    </Suspense>
  );
}

function HostMobilePreview() {
  const requested = useSearchParams().get("surface");
  const surface = SURFACES.includes(requested as Surface)
    ? (requested as Surface)
    : "overview";

  return (
    <main style={{ minHeight: "100dvh", width: "100%", overflowX: "hidden" }}>
      {surface === "overview" && <HostGenOverview />}
      {surface === "topic" && <HostGenTopicEntry />}
      {surface === "loading" && <HostGenLoading />}
      {surface === "pick" && (
        <HostGenPick
          onTogglePick={() => {}}
          onReorder={() => {}}
          onEdit={() => {}}
        />
      )}
      {surface === "edit" && <HostGenEdit />}
      {surface === "image-swap" && <HostGenImageSwap />}
      {surface === "image-upload" && <HostGenImageUpload state="idle" />}
      {surface === "manual" && <HostGenManualEntry />}
    </main>
  );
}
