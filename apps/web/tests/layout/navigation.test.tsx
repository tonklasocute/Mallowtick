import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BottomNav } from "@/components/layout/bottom-nav";
import { SideNav } from "@/components/layout/side-nav";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe.each([
  ["BottomNav", BottomNav],
  ["SideNav", SideNav],
])("%s", (_name, Nav) => {
  it.each([
    ["/", "Discover"],
    ["/stocks/AAPL", "Discover"],
    ["/watchlist", "Watchlist"],
    ["/more", "More"],
  ])("marks %s as %s", (path, active) => {
    pathname.current = path;
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const current = within(nav)
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual([active]);
  });
});
