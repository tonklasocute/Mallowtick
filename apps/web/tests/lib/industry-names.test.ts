import { describe, expect, it } from "vitest";

import { industryName } from "@/lib/industry-names";

describe("industryName", () => {
  it("names Finnhub's industries in Thai", () => {
    // Values seen in real Finnhub profiles (AAPL, JPM, NVDA, UNH, MCD).
    expect(industryName("Technology")).toBe("เทคโนโลยี");
    expect(industryName("Banking")).toBe("ธนาคาร");
    expect(industryName("Semiconductors")).toBe("เซมิคอนดักเตอร์");
    expect(industryName("Health Care")).toBe("การแพทย์");
    expect(industryName("Hotels, Restaurants & Leisure")).toBe("ร้านอาหารและท่องเที่ยว");
  });

  it("ignores case and spacing", () => {
    // Finnhub writes "Consumer products" with a lower-case p.
    expect(industryName("Consumer products")).toBe("สินค้าอุปโภคบริโภค");
    expect(industryName("Consumer Products")).toBe("สินค้าอุปโภคบริโภค");
    expect(industryName("  life sciences  tools & services ")).toBe("เครื่องมือวิทยาศาสตร์ชีวภาพ");
  });

  it("keeps the vendor's English text for an industry it doesn't know", () => {
    expect(industryName("Space Tourism")).toBe("Space Tourism");
    expect(industryName("")).toBe("");
  });
});
