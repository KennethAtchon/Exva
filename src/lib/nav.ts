import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Layers,
  LayoutDashboard,
  Microscope,
  Radio,
  Settings2,
} from "lucide-react";

/** Five hubs + Docs. Detail overlays (TradeDetail, trade autopsy) are not nav items. */
export type PageKey =
  | "dashboard"
  | "sessions"
  | "signals"
  | "research"
  | "settings"
  | "docs";

export type NavItem = { id: PageKey; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "sessions", label: "Sessions", icon: Layers },
  { id: "signals", label: "Signals", icon: Radio },
  { id: "research", label: "Research", icon: Microscope },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "docs", label: "Docs", icon: BookOpen },
];

/** Primary rail: five hubs. Docs is pinned separately at the rail bottom. */
export const NAV_PRIMARY_IDS: PageKey[] = [
  "dashboard",
  "sessions",
  "signals",
  "research",
  "settings",
];

const navItemById = new Map(NAV_ITEMS.map((item) => [item.id, item]));

export function getNavItem(id: PageKey): NavItem {
  const item = navItemById.get(id);
  if (!item) {
    throw new Error(`Unknown nav item: ${id}`);
  }
  return item;
}
