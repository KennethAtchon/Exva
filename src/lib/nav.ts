import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  Code2,
  Landmark,
  Layers,
  LayoutDashboard,
  Microscope,
  Radio,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";

export type PageKey =
  | "dashboard"
  | "sessions"
  | "brokers"
  | "trades"
  | "autopsy"
  | "strategy"
  | "signals"
  | "costs"
  | "devpanel"
  | "accounts";

export const NAV_WIDE_MEDIA = "(min-width: 1200px)";

export const NAV_ITEMS: { id: PageKey; label: string; icon: LucideIcon }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "sessions", label: "Sessions", icon: Layers },
  { id: "brokers", label: "Brokers", icon: Landmark },
  { id: "trades", label: "Trades", icon: ArrowLeftRight },
  { id: "autopsy", label: "Autopsy", icon: Microscope },
  { id: "strategy", label: "Strategy", icon: SlidersHorizontal },
  { id: "signals", label: "Signals", icon: Radio },
  { id: "costs", label: "API Usage", icon: BarChart3 },
  { id: "devpanel", label: "Developer", icon: Code2 },
  { id: "accounts", label: "Accounts", icon: Wallet },
];
