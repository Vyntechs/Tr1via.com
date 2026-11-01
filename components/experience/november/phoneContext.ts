// November · true inside a player phone screen dressed as the Harvest Field
// (set by PhoneScreen). Lets shared pieces such as AnswerCard take the field
// look on phones only; the TV and every other month never see it.

"use client";

import { createContext, useContext } from "react";
import { phoneGameSky, type HarvestSky } from "@/lib/experience/november/phone";

export const NovemberPhoneContext = createContext(false);

export function useNovemberPhone(): boolean {
  return useContext(NovemberPhoneContext);
}

// Which game the room is in (1 or 2), set by the player room page, so the
// question, locked and wrong-answer screens can show the TV's light for that
// game: dusk in game 1, night in game 2. No room (dev gallery, tests) = game 1.
// PhoneScreen ignores the sky on every month but November.
export const NovemberGameNoContext = createContext<number | null>(null);

export function useNovemberGameSky(): HarvestSky {
  return phoneGameSky(useContext(NovemberGameNoContext));
}
