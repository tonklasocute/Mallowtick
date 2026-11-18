import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AlertBell } from "@/features/alerts/alert-bell";
import { initialState, newRule } from "@/features/alerts/alert-model";
import { MemoryAlertStore } from "@/features/alerts/alert-store";
import { AlertsScreen } from "@/features/alerts/alerts-screen";

import { freshness, ok, quote } from "../fixtures";
import { renderWithProviders } from "../render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));

afterEach(() => vi.unstubAllGlobals());

/** The API answers nothing useful; tests feed data through the query cache. */
function quietApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ok({ quotes: [], unavailable: [] })),
  );
}

function freshQuote(price: number, stale = false) {
  const now = new Date().toISOString();
  return quote({
    symbol: "AAPL",
    price,
    asOf: now,
    freshness: freshness({ fetchedAt: now, stale }),
  });
}

async function storeWithRule(threshold = 200) {
  const store = new MemoryAlertStore();
  await store.putRule(
    newRule({ symbol: "AAPL", type: "price_above", threshold }, new Date(), "r1"),
  );
  await store.commit([initialState("r1")], []);
  return store;
}

describe("alerts", () => {
  it("creates a rule from the sheet and lists it", async () => {
    quietApi();
    const store = new MemoryAlertStore();
    renderWithProviders(<AlertsScreen newFor="NVDA" />, { alerts: store });
    const user = userEvent.setup();
    const dialog = await screen.findByRole("dialog", { name: "ตั้งการแจ้งเตือน" });
    expect(within(dialog).getByLabelText("หุ้น")).toHaveValue("NVDA");

    // An invalid price is refused with a Thai message.
    await user.click(within(dialog).getByRole("button", { name: "บันทึกการแจ้งเตือน" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("ใส่ราคาที่มากกว่า 0");

    await user.type(within(dialog).getByLabelText("ราคา (USD)"), "250");
    await user.click(within(dialog).getByRole("button", { name: "บันทึกการแจ้งเตือน" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await store.listRules()).toMatchObject([
      { symbol: "NVDA", type: "price_above", threshold: 250 },
    ]);

    await user.click(screen.getByRole("radio", { name: "กฎ (1)" }));
    const rule = screen.getByRole("listitem", { name: "NVDA · ราคาสูงกว่า $250.00" });
    await user.click(within(rule).getByRole("switch"));
    await waitFor(async () => expect((await store.listRules())[0]?.enabled).toBe(false));
    await user.click(within(rule).getByRole("button", { name: "ลบ" }));
    await waitFor(async () => expect(await store.listRules()).toEqual([]));
  });

  it("raises an alert from fresh data the app received, once, and shows it", async () => {
    quietApi();
    const store = await storeWithRule();
    const { client } = renderWithProviders(
      <>
        <AlertBell />
        <AlertsScreen />
      </>,
      { alerts: store },
    );
    expect(await screen.findByText("ยังไม่มีการแจ้งเตือน")).toBeInTheDocument(); // store open

    act(() => client.setQueryData(["quote", "AAPL"], freshQuote(195)));
    act(() => client.setQueryData(["quote", "AAPL"], freshQuote(205)));
    act(() => client.setQueryData(["quote", "AAPL"], freshQuote(206)));

    expect(
      await screen.findByRole("link", { name: "การแจ้งเตือน ยังไม่อ่าน 1 รายการ" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("AAPL ราคาสูงกว่า $200.00");
    const events = await store.listEvents();
    expect(events).toHaveLength(1);
    expect(events[0]!.facts).toContainEqual({ label: "ราคา", value: "$205.00" });
  });

  it("checks data loaded before the alert store opened, when it opens", async () => {
    quietApi();
    const store = await storeWithRule();
    let open = () => {};
    const opened = new Promise<void>((resolve) => (open = resolve));
    const { client } = renderWithProviders(<AlertBell />, { alerts: store, openAlerts: opened });
    act(() => client.setQueryData(["quote", "AAPL"], freshQuote(207)));
    await act(async () => open());
    expect(
      await screen.findByRole("link", { name: "การแจ้งเตือน ยังไม่อ่าน 1 รายการ" }),
    ).toBeInTheDocument();
    expect((await store.listEvents())[0]!.facts).toContainEqual({
      label: "ราคา",
      value: "$207.00",
    });
  });

  it("checks data that arrives while the app is open", async () => {
    quietApi();
    const store = await storeWithRule();
    const { client } = renderWithProviders(<AlertsScreen />, { alerts: store });
    // Rendered only once the store is open.
    expect(await screen.findByText("ยังไม่มีการแจ้งเตือน")).toBeInTheDocument();
    act(() => client.setQueryData(["quote", "AAPL"], freshQuote(201)));
    expect(
      await screen.findByRole("listitem", { name: "AAPL ราคาสูงกว่า $200.00" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "แจ้งเตือน (1)" })).toBeChecked();
  });

  it("never raises an alert from stale data", async () => {
    quietApi();
    const store = await storeWithRule();
    const { client } = renderWithProviders(<AlertBell />, { alerts: store });
    await screen.findByRole("link", { name: "การแจ้งเตือน" });
    act(() => client.setQueryData(["quote", "AAPL"], freshQuote(250, true)));
    await new Promise((r) => setTimeout(r, 50));
    expect(await store.listEvents()).toEqual([]);
    expect(screen.getByRole("link", { name: "การแจ้งเตือน" })).toBeInTheDocument();
  });

  it("marks alerts read and deletes them in the notification center", async () => {
    quietApi();
    const store = await storeWithRule();
    await store.commit(
      [],
      [
        {
          id: "e1",
          ruleId: "r1",
          symbol: "AAPL",
          type: "price_above",
          title: "AAPL ราคาสูงกว่า $200.00",
          message: "ราคาระหว่างเวลาทำการ",
          facts: [{ label: "ราคา", value: "$205.00" }],
          source: "Finnhub",
          dataAsOf: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          read: false,
          marketOpen: true,
          url: null,
        },
      ],
    );
    renderWithProviders(<AlertsScreen />, { alerts: store });
    const user = userEvent.setup();
    const item = await screen.findByRole("listitem", { name: "AAPL ราคาสูงกว่า $200.00" });
    expect(within(item).getByLabelText("ยังไม่อ่าน")).toBeInTheDocument();
    expect(item).toHaveTextContent("ข้อมูลจาก Finnhub");

    await user.click(screen.getByRole("button", { name: "อ่านทั้งหมด" }));
    await waitFor(async () => expect((await store.listEvents())[0]?.read).toBe(true));
    await user.click(within(item).getByRole("button", { name: /ลบการแจ้งเตือน/ }));
    expect(await screen.findByText("ยังไม่มีการแจ้งเตือน")).toBeInTheDocument();
  });

  it("explains when alerts can't be saved on this device", async () => {
    quietApi();
    renderWithProviders(<AlertsScreen />, {
      alerts: new MemoryAlertStore("เบราว์เซอร์นี้บันทึกการแจ้งเตือนไม่ได้ กฎจะหายเมื่อปิดแอป"),
    });
    expect(await screen.findByText(/บันทึกการแจ้งเตือนไม่ได้/)).toBeInTheDocument();
    expect(screen.getByText(/ไม่มีการแจ้งเตือนเบื้องหลังบน iPhone/)).toBeInTheDocument();
  });
});
