// November · true inside a player phone screen dressed as the Harvest Field
// (set by PhoneScreen). Lets shared pieces such as AnswerCard take the field
// look on phones only; the TV and every other month never see it.

"use client";

import { createContext, useContext } from "react";

export const NovemberPhoneContext = createContext(false);

export function useNovemberPhone(): boolean {
  return useContext(NovemberPhoneContext);
}
