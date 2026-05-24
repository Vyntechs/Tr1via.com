// Placeholder for /host/nights. Wired into the sidebar shortcuts but the
// real "all nights" archive UI is post-MVP work.

import { ComingSoonPage } from "@/components/host/ComingSoonPage";

export default function HostNightsPage() {
  return (
    <ComingSoonPage
      eyebrow="ALL NIGHTS"
      title="Your archive lives here."
      body="Past nights, replays, leaderboards, and exports. This screen is on the roadmap — for now, tonight's setup is your home base."
    />
  );
}
