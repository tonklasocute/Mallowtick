import { describe, expect, it } from "vitest";

import ComparePage from "@/app/compare/page";

describe("compare page", () => {
  it("takes up to four valid, distinct symbols from the URL", async () => {
    const el = await ComparePage({
      searchParams: Promise.resolve({ symbols: "nvda,MSFT,bad!,msft,AAPL,TSLA,RKLB" }),
    });
    expect(el.props.initial).toEqual(["NVDA", "MSFT", "AAPL", "TSLA"]);
    const none = await ComparePage({ searchParams: Promise.resolve({}) });
    expect(none.props.initial).toEqual([]);
  });
});
