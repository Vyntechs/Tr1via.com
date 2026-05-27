// Suspense fallback for /host (the dashboard). Renders inside LaptopShell
// so the visual frame matches the page that follows.

import { LaptopShell } from "@/components/shells/LaptopShell";
import { Spinner } from "@/components/system/Spinner";
import { Eyebrow } from "@/components/system/Eyebrow";

export default function HostLoading() {
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
        <Spinner size="lg" label="Loading the dashboard" />
        <Eyebrow color="var(--ink-mid)" size={11}>
          PULLING YOUR NIGHTS
        </Eyebrow>
      </div>
    </LaptopShell>
  );
}
