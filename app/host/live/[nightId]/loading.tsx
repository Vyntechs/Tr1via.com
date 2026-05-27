// Suspense fallback for /host/live/[nightId] — the mid-game console.
// The server component fetches the night first to pass the room code into
// the client wrapper. While that's in flight we hold this neutral panel
// inside LaptopShell.

import { LaptopShell } from "@/components/shells/LaptopShell";
import { Spinner } from "@/components/system/Spinner";
import { Eyebrow } from "@/components/system/Eyebrow";

export default function HostLiveLoading() {
  return (
    <LaptopShell>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
        }}
      >
        <Spinner size="lg" label="Loading the live console" />
        <Eyebrow color="var(--ink-mid)" size={11}>
          TUNING IN TO THE ROOM
        </Eyebrow>
      </div>
    </LaptopShell>
  );
}
