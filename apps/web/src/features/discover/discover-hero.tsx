import { Mascot } from "@/components/brand/mascot";
import { MarketStatusPill } from "@/components/market/market-status-pill";
import { BRAND } from "@/lib/brand";

/** Compact brand greeting: mascot, tagline and market status. Kept short so data stays above the fold. */
export function DiscoverHero() {
  return (
    <section
      aria-labelledby="discover-hero-title"
      className="relative overflow-hidden rounded-card border border-mint/60 bg-mint-soft p-4 lg:p-5"
    >
      {/* Decorative pastel shapes; not data. */}
      <span aria-hidden className="absolute -top-8 -right-6 size-28 rounded-full bg-sky/50" />
      <span
        aria-hidden
        className="absolute right-20 -bottom-10 size-20 rounded-full bg-accent-soft"
      />
      <div className="relative flex items-center gap-3 lg:gap-4">
        <Mascot size={64} className="lg:size-20" />
        <div className="min-w-0 space-y-1.5">
          <h2
            id="discover-hero-title"
            className="font-display text-xl leading-tight font-bold text-ink lg:text-2xl"
          >
            {BRAND.tagline}
          </h2>
          <p className="text-sm text-slate-strong">
            ค้นหาหุ้นสหรัฐฯ ดูภาพรวมตลาด และเก็บหุ้นที่สนใจไว้ใกล้ ๆ ตัว
          </p>
          <MarketStatusPill />
        </div>
      </div>
    </section>
  );
}
