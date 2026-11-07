import { describe, expect, it } from "vitest";

import { vendorLabel } from "@/lib/providers";

describe("vendorLabel", () => {
  it("names known vendors and leaves unknown ids as sent", () => {
    expect(vendorLabel("twelvedata")).toBe("Twelve Data");
    expect(vendorLabel("finnhub")).toBe("Finnhub");
    expect(vendorLabel("polygon")).toBe("polygon");
    expect(vendorLabel("")).toBe("");
  });

  it("names every vendor of combined data", () => {
    // A chart whose latest bar comes from another vendor's quote.
    expect(vendorLabel("twelvedata+finnhub")).toBe("Twelve Data + Finnhub");
    expect(vendorLabel("finnhub+twelvedata")).toBe("Finnhub + Twelve Data");
    expect(vendorLabel("twelvedata+polygon")).toBe("Twelve Data + polygon");
  });
});
