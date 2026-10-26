import { unavailableReasonLabel } from "@/lib/unavailable-reason";
import type { MarketOverview, Quote, UnavailableSymbol } from "@/types/api";

export interface UnavailableItem {
  symbol: string;
  code: string;
  label: string;
}

export interface OverviewModel {
  /** First benchmark, shown as the large card. */
  hero: Quote | null;
  /** Remaining benchmarks, shown as tiles. */
  tiles: Quote[];
  unavailableBenchmarks: UnavailableItem[];
  popular: Quote[];
  unavailablePopular: UnavailableItem[];
  /** Missing symbols the API didn't assign to a section. */
  unavailableOther: UnavailableItem[];
  showBenchmarks: boolean;
  showPopular: boolean;
  /** Nothing is configured on the server. */
  isEmpty: boolean;
}

const toItem = (u: UnavailableSymbol): UnavailableItem => ({
  symbol: u.symbol,
  code: u.reason,
  label: unavailableReasonLabel(u.reason),
});

/** Turns the overview response into what the Discover screen renders. */
export function buildOverviewModel(ov: MarketOverview): OverviewModel {
  const [hero = null, ...tiles] = ov.benchmarks;
  const byGroup = (g: UnavailableSymbol["group"]) =>
    ov.unavailable.filter((u) => u.group === g).map(toItem);
  const unavailableBenchmarks = byGroup("benchmark");
  const unavailablePopular = byGroup("popular");
  const unavailableOther = ov.unavailable.filter((u) => !u.group).map(toItem);

  const showBenchmarks = ov.benchmarks.length + unavailableBenchmarks.length > 0;
  const showPopular = ov.popular.length + unavailablePopular.length > 0;
  return {
    hero,
    tiles,
    unavailableBenchmarks,
    popular: ov.popular,
    unavailablePopular,
    unavailableOther,
    showBenchmarks,
    showPopular,
    isEmpty: !showBenchmarks && !showPopular && unavailableOther.length === 0,
  };
}
