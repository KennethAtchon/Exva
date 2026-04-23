import { create } from "zustand";
import type { Trade } from "@/lib/types";

interface TradeState {
  trades: Trade[];
  selectedId: string | null;
  setTrades: (t: Trade[]) => void;
  upsertTrade: (t: Trade) => void;
  setSelected: (id: string | null) => void;
}

export const useTradeStore = create<TradeState>((set) => ({
  trades: [],
  selectedId: null,
  setTrades: (trades) => set({ trades }),
  upsertTrade: (t) =>
    set((state) => {
      const idx = state.trades.findIndex((x) => x.id === t.id);
      if (idx === -1) return { trades: [t, ...state.trades] };
      const next = state.trades.slice();
      next[idx] = t;
      return { trades: next };
    }),
  setSelected: (selectedId) => set({ selectedId }),
}));
