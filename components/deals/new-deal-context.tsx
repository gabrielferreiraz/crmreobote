"use client";

import { createContext, useContext } from "react";

export type NewDealContextValue = {
  openNewDeal: () => void;
  preloadNewDeal: () => void;
};

export const NewDealContext = createContext<NewDealContextValue | null>(null);

export function useNewDeal() {
  const context = useContext(NewDealContext);
  if (!context) throw new Error("useNewDeal deve ser usado dentro de NewDealProvider");
  return context;
}
