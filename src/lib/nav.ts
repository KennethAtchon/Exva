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

export const NAV_WIDE_MEDIA = "(min-width: 1200px)";

export type NavItem = { id: PageKey; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "sessions", label: "Sessions", icon: Layers },
  { id: "signals", label: "Signals", icon: Radio },
  { id: "research", label: "Research", icon: Microscope },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "docs", label: "Docs", icon: BookOpen },
];

/** Primary horizontal nav: five hubs. Docs stays reachable but secondary. */
export const NAV_PRIMARY_IDS: PageKey[] = [
  "dashboard",
  "sessions",
  "signals",
  "research",
  "settings",
];

export type NavGroupId = "reference";

export type NavGroup = {
  id: NavGroupId;
  label: string;
  itemIds: PageKey[];
};

/** Docs sits in a light group so the primary rail stays five hubs. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: "reference",
    label: "Reference",
    itemIds: ["docs"],
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
