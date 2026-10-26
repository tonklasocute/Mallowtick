import { Compass, Settings2, Star, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Filled icon when active (used for the star). */
  fillWhenActive?: boolean;
  match: (pathname: string) => boolean;
}

/** Primary destinations, shared by the mobile bottom nav and the desktop sidebar. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/",
    label: "Discover",
    Icon: Compass,
    match: (p) => p === "/" || p.startsWith("/stocks"),
  },
  {
    href: "/watchlist",
    label: "Watchlist",
    Icon: Star,
    fillWhenActive: true,
    match: (p) => p.startsWith("/watchlist"),
  },
  { href: "/more", label: "More", Icon: Settings2, match: (p) => p.startsWith("/more") },
];
