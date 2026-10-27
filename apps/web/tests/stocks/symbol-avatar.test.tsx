import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QuoteRow } from "@/components/stocks/quote-row";
import { SymbolAvatar } from "@/components/stocks/symbol-avatar";

import { quote } from "../fixtures";

const LOGO = "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png";

/** The avatar is aria-hidden, so its image has no accessible role; find it by tag. */
const logoImage = (container: HTMLElement) => container.querySelector("img");

describe("SymbolAvatar", () => {
  it("shows only the initials when there is no logo", () => {
    const { container } = render(<SymbolAvatar symbol="SPY" logo="" />);
    expect(screen.getByText("SPY")).toBeInTheDocument();
    expect(logoImage(container)).toBeNull();
  });

  it("requests the logo through the image optimizer at avatar size", () => {
    const { container } = render(<SymbolAvatar symbol="AAPL" logo={LOGO} />);
    const img = logoImage(container)!;
    // next/image rewrites the vendor URL to /_next/image, which shrinks and caches it.
    expect(img.getAttribute("src")).toMatch(
      /\/_next\/image\?url=https%3A%2F%2Fstatic2\.finnhub\.io%2F.*&w=96&q=75$/,
    );
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "40");
    // The initials stay underneath while the logo loads.
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("falls back to the initials when the logo fails to load", () => {
    const { container } = render(<SymbolAvatar symbol="AAPL" logo={LOGO} />);
    fireEvent.error(logoImage(container)!);
    expect(logoImage(container)).toBeNull();
    expect(screen.getByText("AAPL")).toBeInTheDocument();
  });

  it("tries again when the symbol gets a different logo", () => {
    const other = LOGO.replace("AAPL", "MSFT");
    const { container, rerender } = render(<SymbolAvatar symbol="AAPL" logo={LOGO} />);
    fireEvent.error(logoImage(container)!);
    rerender(<SymbolAvatar symbol="AAPL" logo={other} />);
    expect(logoImage(container)?.getAttribute("src")).toContain("MSFT.png");
  });

  it("is used by quote rows with the quote's logo", () => {
    const { container } = render(
      <ul>
        <QuoteRow quote={quote({ logo: LOGO })} receivedAt={Date.now()} />
      </ul>,
    );
    expect(logoImage(container)?.getAttribute("src")).toContain("AAPL.png");
  });
});
