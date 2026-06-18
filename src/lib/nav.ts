import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Code2,
  Landmark,
  Layers,
  LayoutDashboard,
  Microscope,
  Radio,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  Wallet,
} from "lucide-react";

export type PageKey =
  | "assistant"
  | "dashboard"
  | "sessions"
  | "brokers"
  | "trades"
  | "autopsy"
  | "leaderboard"
  | "strategy"
  | "signals"
  | "costs"
  | "devpanel"
  | "accounts"
  | "docs";

export const NAV_WIDE_MEDIA = "(min-width: 1200px)";

export type NavItem = { id: PageKey; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "assistant", label: "Assistant", icon: Sparkles },
  { id: "sessions", label: "Sessions", icon: Layers },
  { id: "brokers", label: "Brokers", icon: Landmark },
  { id: "trades", label: "Trades", icon: ArrowLeftRight },
  { id: "autopsy", label: "Autopsy", icon: Microscope },
  { id: "leaderboard", label: "Leaderboard", icon: Trophy },
  { id: "strategy", label: "Strategy", icon: SlidersHorizontal },
  { id: "signals", label: "Signals", icon: Radio },
  { id: "costs", label: "API Usage", icon: BarChart3 },
  { id: "devpanel", label: "Developer", icon: Code2 },
  { id: "accounts", label: "Accounts", icon: Wallet },
  { id: "docs", label: "Docs", icon: BookOpen },
];

/** Top-level tabs on the wide horizontal nav bar. */
export const NAV_PRIMARY_IDS: PageKey[] = [
  "dashboard",
  "assistant",
  "sessions",
  "trades",
  "strategy",
];

export type NavGroupId = "analysis" | "setup";

export type NavGroup = {
  id: NavGroupId;
  label: string;
  itemIds: PageKey[];
};

/** Secondary destinations grouped into dropdowns on the wide nav bar. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "analysis",
    label: "Analysis",
    itemIds: ["autopsy", "leaderboard", "costs"],
  },
  {
    id: "setup",
    label: "Setup",
    itemIds: ["brokers", "signals", "accounts", "docs", "devpanel"],
  },
];

const navItemById = new Map(NAV_ITEMS.map((item) => [item.id, item]));

export function getNavItem(id: PageKey): NavItem {
  const item = navItemById.get(id);
  if (!item) {
    throw new Error(`Unknown nav item: ${id}`);
  }
  return item;
}

export function getNavGroupForPage(page: PageKey): NavGroup | undefined {
  return NAV_GROUPS.find((group) => group.itemIds.includes(page));
}
