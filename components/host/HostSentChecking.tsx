// components/host/HostSentChecking.tsx
// The calm note for a host action whose reply went missing. It is deliberately
// not the red alert: the action may well have worked, and a red box in front of
// the room would say otherwise. Sits below HostConnectionBanner.

"use client";

import { SENT_CHECKING_MESSAGE } from "@/lib/host/hostFetch";

export function HostSentChecking() {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="host-sent-checking"
      className="fixed left-1/2 top-14 z-50 -translate-x-1/2 rounded-full bg-amber-500/90 px-4 py-1.5 text-sm font-medium text-black shadow-lg"
    >
      {SENT_CHECKING_MESSAGE}
    </div>
  );
}
