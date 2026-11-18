import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpcomingEarnings } from "@/features/portfolio/upcoming-earnings";
import type { EarningsEvent } from "@/types/api";

import { apiError, freshness, ok } from "../fixtures";
import { renderWithProviders } from "../render";

afterEach(() => vi.unstubAllGlobals());

const NOW = new Date("2026-11-18T03:00:00Z"); // 2026-11-17 in New York

function ev(symbol: string, date: string, extra: Partial<EarningsEvent> = {}): EarningsEvent {
  return {
    symbol,
    date,
    hour: "amc",
    epsEstimate: 1.25,
    revenueEstimate: null,
    epsActual: null,
    revenueActual: null,
    ...extra,
  };
}

describe("UpcomingEarnings", () => {
  it("lists the held stocks' next reports soonest first, asking only for their tickers", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () =>
      ok({
        from: "2026-11-17",
        to: "2026-12-14",
        today: "2026-11-17",
        events: [
          ev("NVDA", "2026-11-17", { epsActual: 2.68 }), // reported already: not upcoming
          ev("AAPL", "2026-11-18", { hour: "bmo" }),
          ev("CRM", "2026-12-02", { epsEstimate: null }),
        ],
        truncated: false,
        freshness: freshness({ provider: "finnhub" }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderWithProviders(<UpcomingEarnings symbols={["CRM", "AAPL", "NVDA"]} now={NOW} />);

    const items = await screen.findAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringMatching(/^AAPL18 พ.ย. 2026 · ก่อนตลาดเปิด · EPS คาด 1.25พรุ่งนี้$/),
      expect.stringMatching(/^CRM2 ธ.ค. 2026 · หลังตลาดปิดอีก 15 วัน$/),
    ]);
    const url = new URL(String(fetchMock.mock.calls[0]![0]), "http://localhost");
    expect(url.searchParams.get("symbols")).toBe("AAPL,CRM,NVDA");
    expect(url.searchParams.get("from")).toBe("2026-11-17");
    expect(url.searchParams.get("to")).toBe("2026-12-14");
  });

  it("says when nothing is scheduled, and hides without an earnings vendor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        ok({
          from: "2026-11-17",
          to: "2026-12-14",
          today: "2026-11-17",
          events: [],
          truncated: false,
          freshness: freshness({ provider: "finnhub" }),
        }),
      ),
    );
    const first = renderWithProviders(<UpcomingEarnings symbols={["AAPL"]} now={NOW} />);
    expect(
      await screen.findByText("ไม่มีหุ้นในพอร์ตประกาศงบใน 4 สัปดาห์ข้างหน้า"),
    ).toBeInTheDocument();
    first.unmount();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => apiError(503, "provider_not_configured")),
    );
    const second = renderWithProviders(<UpcomingEarnings symbols={["AAPL"]} now={NOW} />);
    await waitFor(() => expect(second.container).toBeEmptyDOMElement());
  });
});
