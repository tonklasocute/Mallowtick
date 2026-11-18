import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NewsCard } from "@/features/news/news-card";
import { formatRelativeTime } from "@/lib/format";
import { safeExternalUrl } from "@/lib/links";

import { NOW } from "../fixtures";
import { newsArticle } from "./fixtures";

describe("NewsCard", () => {
  it("links the headline to the vendor's URL in a new tab and credits every publisher", () => {
    const a = newsArticle({
      related: ["AAPL", "TSM"],
      sources: [
        {
          id: "fh-1",
          source: "Yahoo",
          url: "https://finnhub.io/api/news?id=a1",
          publishedAt: "2026-10-23T17:00:00Z",
        },
        {
          id: "fh-2",
          source: "Reuters",
          url: "https://reuters.com/x",
          publishedAt: "2026-10-23T18:00:00Z",
        },
      ],
    });
    render(<NewsCard article={a} now={NOW} />);
    const card = screen.getByRole("article");
    const headline = within(card).getByRole("link", { name: a.headline });
    expect(headline).toHaveAttribute("href", a.url);
    expect(headline).toHaveAttribute("target", "_blank");
    expect(headline).toHaveAttribute("rel", "noopener noreferrer");
    expect(card).toHaveTextContent("Yahoo·2 ชม. ที่แล้วข่าวบริษัท");
    expect(within(card).getByRole("link", { name: "TSM" })).toHaveAttribute("href", "/stocks/TSM");
    expect(within(card).getByText("รายงานโดยอีก 1 แหล่งข่าว")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Reuters" })).toHaveAttribute(
      "href",
      "https://reuters.com/x",
    );
  });

  it("never turns an unsafe URL into a link, and never invents a publisher", () => {
    render(
      <NewsCard
        article={newsArticle({ url: "javascript:alert(1)", source: "", summary: "", sources: [] })}
        now={NOW}
      />,
    );
    expect(screen.queryByRole("link", { name: /Apple supplier/ })).not.toBeInTheDocument();
    expect(screen.queryByText("อ่านข่าวต้นฉบับ")).not.toBeInTheDocument();
    expect(screen.getByText("ไม่ระบุแหล่งข่าว")).toBeInTheDocument();
  });
});

describe("link and time helpers", () => {
  it("accepts only absolute http(s) URLs", () => {
    expect(safeExternalUrl("https://a.com/x")).toBe("https://a.com/x");
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("/relative")).toBeNull();
    expect(safeExternalUrl("data:text/html,hi")).toBeNull();
    expect(safeExternalUrl("")).toBeNull();
  });

  it("says how long ago in Thai", () => {
    const now = new Date("2026-11-18T12:00:00Z");
    expect(formatRelativeTime("2026-11-18T11:59:40Z", now)).toBe("เมื่อสักครู่");
    expect(formatRelativeTime("2026-11-18T11:15:00Z", now)).toBe("45 นาทีที่แล้ว");
    expect(formatRelativeTime("2026-11-18T07:00:00Z", now)).toBe("5 ชม. ที่แล้ว");
    expect(formatRelativeTime("2026-11-15T12:00:00Z", now)).toBe("3 วันที่แล้ว");
    expect(formatRelativeTime(null, now)).toBe("—");
  });
});
