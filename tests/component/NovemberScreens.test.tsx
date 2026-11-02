import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { NovemberBetweenGames, NovemberBoard, NovemberLobby } from "@/components/experience/november/tv/NovemberScreens";
import { ThemeProvider } from "@/components/system";

const inNovember = (ui: ReactElement) => render(<ThemeProvider themeKey="november">{ui}</ThemeProvider>);

describe("November TV screens keep the everyday content and test ids", () => {
  it("lobby: room code, QR, newest player, count and topics", () => {
    inNovember(
      <NovemberLobby
        venueName="SOUL FIRE PIZZA"
        roomCode="K9P·R4M"
        joinUrl="https://tr1via.com/join?code=K9PR4M"
        inRoomCount={18}
        roster={["Ricky Bobby", "Ruby"]}
        topics={[
          { position: 1, label: "Willie Nelson", name: "Willie Nelson", color: null },
          { position: 2, label: "Geography", name: "Geography", color: null },
        ] as never}
      />,
    );
    expect(screen.getByTestId("tv-lobby")).toBeTruthy();
    expect(screen.getByTestId("tv-lobby-room-code").textContent).toBe("K9P·R4M");
    expect(screen.getByTestId("tv-lobby-qr")).toBeTruthy();
    expect(screen.getByTestId("tv-lobby-roster").textContent).toContain("Ricky Bobby");
    expect(screen.getByTestId("november-lobby-count").textContent).toBe("18");
    expect(screen.getAllByTestId("tv-lobby-topic").map((n) => n.textContent)).toEqual(["Willie Nelson", "Geography"]);
    expect(screen.getByText("Grab a spot in the field.")).toBeTruthy();
  });

  it("board: cells, host click, standings, no off-palette chip", () => {
    const onCellClick = vi.fn();
    inNovember(
      <NovemberBoard
        categories={["Rodents", "Subway"]}
        values={[100, 200]}
        cells={[
          [
            { played: false, selected: true, value: 100 },
            { played: false, selected: false, value: 200, questionId: "q2" },
          ],
          [
            { played: true, selected: false, value: 100 },
            { played: false, selected: false, value: 200 },
          ],
        ]}
        leaders={[
          { rank: 1, name: "Coach K", score: 1450 },
          { rank: 2, name: "Ricky Bobby", score: 1210 },
        ]}
        boardLeft={21}
        onCellClick={onCellClick}
      />,
    );
    expect(screen.getByTestId("tv-grid")).toBeTruthy();
    expect(screen.getByTestId("tv-grid-cell-0-100")).toBeTruthy();
    fireEvent.click(screen.getByTestId("host-question-q2"));
    expect(onCellClick).toHaveBeenCalledWith("q2");
    const rows = screen.getAllByTestId(/^tv-grid-standing-\d+$/);
    expect(rows.map((r) => within(r).getByTestId("tv-grid-standing-name").textContent)).toEqual(["Coach K", "Ricky Bobby"]);
    expect(screen.getByTestId("november-board-left").textContent).toBe("21 left");
    expect(screen.getByText("Leader wears the gold tail.")).toBeTruthy();
    expect(document.body.innerHTML.toLowerCase()).not.toMatch(/#(5ee0ff|22d3ee|00e5ff|4dd0e1)/);
  });

  it("between games: standings rows and the 308 QR", () => {
    inNovember(
      <NovemberBetweenGames
        podium={[
          { rank: 1, name: "Coach K", score: 4820 },
          { rank: 2, name: "Ricky Bobby", score: 4310 },
          { rank: 3, name: "Hot Sauce", score: 3990 },
        ]}
        roomCode="K9P·R4M"
        joinUrl="https://tr1via.com/join?code=K9PR4M"
        readyCount={12}
        totalCount={24}
      />,
    );
    expect(screen.getAllByTestId("tv-intermission-podium-row")).toHaveLength(3);
    expect(screen.getByTestId("tv-intermission-qr")).toBeTruthy();
    expect(screen.getByTestId("november-intermission-ready").textContent).toBe("12 of 24 back in");
    expect(screen.getByTestId("november-intermission-room").textContent).toBe("tr1via.com · K9P·R4M");
  });

  it("board: a tie at the top gets no gold-tail line (no single leader)", () => {
    inNovember(
      <NovemberBoard
        categories={["Rodents"]}
        values={[100]}
        leaders={[
          { rank: 1, name: "Coach K", score: 1450 },
          { rank: 1, name: "Ricky Bobby", score: 1450 },
        ]}
      />,
    );
    expect(screen.queryByText("Leader wears the gold tail.")).toBeNull();
  });

  it("between games: everything sits above the turkey row (stage y 676)", () => {
    inNovember(
      <NovemberBetweenGames
        podium={Array.from({ length: 6 }, (_, i) => ({ rank: i + 1, name: `P${i}`, score: 100 - i }))}
        nightStats={[{ v: "12", l: "Questions" }] as never}
        roomCode="K9P·R4M"
        joinUrl="https://tr1via.com/join?code=K9PR4M"
        readyCount={12}
      />,
    );
    // Every absolutely placed box starts above the row; the panels and the QR
    // plate end above it too.
    const stage = screen.getByTestId("november-fit-stage").firstElementChild as HTMLElement; // the 1600×680 box
    for (const el of Array.from(stage.querySelectorAll<HTMLElement>("[style*='position: absolute']"))) {
      const top = parseFloat(el.style.top);
      if (Number.isFinite(top)) expect(top).toBeLessThan(640);
      const h = parseFloat(el.style.height);
      if (Number.isFinite(top) && Number.isFinite(h)) expect(top + h).toBeLessThanOrEqual(656);
    }
  });
});
