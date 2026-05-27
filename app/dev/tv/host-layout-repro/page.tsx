// Repro page for the bug Brandon hit on the Vercel preview: long TV question
// in the HOST LIVE CONSOLE wrapping (not the /dev/tv gallery wrapping).
// HostLiveConsole's TV panel has different flexbox dynamics than the gallery's
// fixed 1280x720 Frame, and the auto-fit hook behaves differently there.
//
// This page wraps TVQuestion in the *exact* same parent structure as
// HostLiveConsole.tsx so we can reproduce and inspect the bug in isolation.

"use client";

import { TVQuestion } from "@/components/tv";
import { LaptopShell } from "@/components/shells";

const PEXELS_ASTRONAUT =
  "https://images.pexels.com/photos/2156/sky-earth-galaxy-universe.jpg?auto=compress&cs=tinysrgb&w=520";

export default function HostLayoutReproPage() {
  return (
    <LaptopShell>
      <div
        data-testid="host-live-console"
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
          background: "#000",
          position: "relative",
        }}
      >
        <div
          data-testid="host-tv-panel"
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            display: "flex",
          }}
        >
          <TVQuestion
            category="Space History"
            value={500}
            seconds={19}
            question="Which Soviet cosmonaut was the first woman in space?"
            options={[
              { n: 1, text: "Svetlana Savitskaya" },
              { n: 2, text: "Valentina Tereshkova" },
              { n: 3, text: "Lyubov Vorobeva" },
              { n: 4, text: "Irina Pronina" },
            ]}
            imageUrl={PEXELS_ASTRONAUT}
            totalPlayers={2}
          />
        </div>
        {/* Stand-in for HostControlStrip — matches its ~80px height. */}
        <div
          style={{
            flexShrink: 0,
            height: 80,
            background: "#0E0805",
            color: "#F4E6C4",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 24px",
            fontFamily: "var(--font-sans)",
            fontSize: 12,
          }}
        >
          <span>End early · reveal</span>
          <span>0 / 2 locked</span>
          <span>Players (2)</span>
        </div>
      </div>
    </LaptopShell>
  );
}
