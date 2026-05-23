// Suspense fallback for the host topic-entry route. Renders inside
// LaptopShell so the loading state matches the topic-entry frame.

import { LaptopShell } from "@/components/shells/LaptopShell";
import { Spinner } from "@/components/system/Spinner";
import { Eyebrow } from "@/components/system/Eyebrow";

export default function HostSetupTopicLoading() {
  return (
    <LaptopShell title="tr1via.com / host / setup / topic">
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
        <Spinner size="lg" label="Loading the topic form" />
        <Eyebrow color="var(--ink-mid)" size={11}>
          GETTING THE SLOT READY
        </Eyebrow>
      </div>
    </LaptopShell>
  );
}
