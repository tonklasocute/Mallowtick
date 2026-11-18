import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalystRatings } from "@/features/stock-detail/analyst-ratings";
import { EarningsHistory } from "@/features/stock-detail/earnings-history";

import { apiError, freshness, ok } from "../fixtures";
import { renderWithProviders } from "../render";

afterEach(() => vi.unstubAllGlobals());

function mockApi(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    return routes[path]?.() ?? apiError(404, "not_found");
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Values reported by Finnhub for RKLB on 2026-10-27.
const QUARTERS = [
  {
    period: "2026-06-30",
    year: 2026,
    quarter: 2,
    actual: -0.08,
    estimate: -0.0765,
    surprise: -0.0035,
    surprisePercent: -4.5752,
  },
  {
    period: "2026-03-31",
    year: 2026,
    quarter: 1,
    actual: -0.07,
    estimate: -0.0815,
    surprise: 0.0115,
    surprisePercent: 14.1104,
  },
  {
    period: "2025-12-31",
    year: 2025,
    quarter: 4,
    actual: -0.09,
    estimate: -0.0942,
    surprise: 0.0042,
    surprisePercent: 4.4586,
  },
  {
    period: "2025-09-30",
    year: 2025,
    quarter: 3,
    actual: -0.03,
    estimate: -0.1064,
    surprise: 0.0764,
    surprisePercent: 71.8045,
  },
];

/** The API's detail fields for quarters the calendar no longer lists. */
const NO_CALENDAR = {
  reportDate: "",
  hour: "",
  revenueActual: null,
  revenueEstimate: null,
  revenueSurprisePercent: null,
  revenueResult: "",
};

function detail(quarters: typeof QUARTERS) {
  return quarters.map((q) => ({
    ...q,
    ...NO_CALENDAR,
    epsResult: q.actual > q.estimate ? "beat" : q.actual < q.estimate ? "miss" : "inline",
  }));
}

const RECORD = { compared: 4, beats: 3, misses: 1, inline: 0 };

describe("EarningsHistory", () => {
  it("lists EPS against estimates and counts the beats", async () => {
    mockApi({
      "/api/v1/earnings/RKLB/history": () =>
        ok({
          symbol: "RKLB",
          quarters: detail(QUARTERS),
          epsRecord: RECORD,
          freshness: freshness({ provider: "finnhub" }),
        }),
    });
    renderWithProviders(<EarningsHistory symbol="RKLB" />);

    expect(
      await screen.findByText(
        (_, el) => el?.tagName === "P" && el.textContent === "EPS ดีกว่าคาด 3 จาก 4 ไตรมาส",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "EPS จริงเทียบกับคาดการณ์ 4 ไตรมาสล่าสุด" }),
    ).toBeInTheDocument();
    const latest = screen.getByText("Q2 2026").closest("tr")!;
    expect(latest).toHaveTextContent("สิ้นสุด มิ.ย. 2026");
    // The estimate keeps its decimals, so the miss is visible next to the actual.
    expect(latest).toHaveTextContent("-0.08คาด -0.0765▼ -4.58%");
    expect(screen.getByText("-4.58%")).toHaveClass("text-down");
    expect(screen.getByText("+14.11%")).toHaveClass("text-up");
    // A 0.42-cent beat (+4.46%) still counts and is green.
    expect(screen.getByText("+4.46%")).toHaveClass("text-up");
  });

  it("shows the latest quarter's revenue and report date from the calendar", async () => {
    const [latest, ...older] = detail(QUARTERS);
    mockApi({
      "/api/v1/earnings/RKLB/history": () =>
        ok({
          symbol: "RKLB",
          quarters: [
            {
              ...latest,
              reportDate: "2026-08-07",
              hour: "amc",
              revenueActual: 144_500_000,
              revenueEstimate: 135_000_000,
              revenueSurprisePercent: 7.037,
              revenueResult: "beat",
            },
            ...older,
          ],
          epsRecord: RECORD,
          freshness: freshness({ provider: "finnhub" }),
        }),
    });
    renderWithProviders(<EarningsHistory symbol="RKLB" />);

    expect(await screen.findByText(/รายได้ Q2 ปีงบ 2026/)).toHaveTextContent(
      "รายได้ Q2 ปีงบ 2026 · ประกาศ 7 ส.ค. 2026",
    );
    expect(screen.getByText("144.5M")).toBeInTheDocument();
    expect(screen.getByText("คาด 135M")).toBeInTheDocument();
    expect(screen.getByText(/ดีกว่าคาด$/)).toHaveTextContent("▲ +7.04% ดีกว่าคาด");
    // The reported quarter shows its report date instead of the fiscal period's end.
    expect(screen.getByText("Q2 2026").closest("tr")).toHaveTextContent(
      "ประกาศ 7 ส.ค. 2026 · หลังตลาดปิด",
    );
    // Older quarters have no revenue in the vendor's data, so no revenue row is invented.
    expect(screen.getAllByText(/^รายได้/)).toHaveLength(1);
  });

  it("shows nothing for a symbol without reports or without a vendor", async () => {
    const fetchMock = mockApi({
      "/api/v1/earnings/RKLB/history": () =>
        ok({
          symbol: "RKLB",
          quarters: [],
          epsRecord: { compared: 0, beats: 0, misses: 0, inline: 0 },
          freshness: freshness({ provider: "finnhub" }),
        }),
    });
    const first = renderWithProviders(<EarningsHistory symbol="RKLB" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(first.container).toBeEmptyDOMElement());
    first.unmount();

    mockApi({
      "/api/v1/earnings/RKLB/history": () => apiError(503, "provider_not_configured"),
    });
    const second = renderWithProviders(<EarningsHistory symbol="RKLB" />);
    await waitFor(() => expect(second.container).toBeEmptyDOMElement());
  });
});

describe("AnalystRatings", () => {
  const trends = [
    { period: "2026-10-01", strongBuy: 7, buy: 16, hold: 5, sell: 0, strongSell: 0 },
    { period: "2026-09-01", strongBuy: 7, buy: 14, hold: 5, sell: 0, strongSell: 0 },
  ];

  it("summarises the latest month with counts beside the bar", async () => {
    mockApi({
      "/api/v1/stocks/RKLB/recommendations": () =>
        ok({ symbol: "RKLB", trends, freshness: freshness({ provider: "finnhub" }) }),
    });
    renderWithProviders(<AnalystRatings symbol="RKLB" />);

    expect(await screen.findByText("82%")).toBeInTheDocument();
    expect(screen.getByText("จากนักวิเคราะห์ 28 ราย")).toBeInTheDocument();
    expect(screen.getByText("ข้อมูล ต.ค. 2026")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "จำนวนนักวิเคราะห์: ซื้อมาก 7, ซื้อ 16, ถือ 5, ขาย 0, ขายมาก 0",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/ไม่ใช่คำแนะนำของ Mallowtick/)).toBeInTheDocument();
  });

  it("shows nothing when no analyst covers the symbol", async () => {
    const fetchMock = mockApi({
      "/api/v1/stocks/RKLB/recommendations": () =>
        ok({ symbol: "RKLB", trends: [], freshness: freshness({ provider: "finnhub" }) }),
    });
    const { container } = renderWithProviders(<AnalystRatings symbol="RKLB" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
