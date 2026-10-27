import { Mascot } from "@/components/brand/mascot";
import { MarketStatusPill } from "@/components/market/market-status-pill";
import { BRAND } from "@/lib/brand";

/** Compact brand greeting: tagline, market status and the mascot. Kept short so data stays above the fold. */
export function DiscoverHero() {
  // "Small charts. Big dreams." reads as two lines in the design.
  const [first, ...rest] = BRAND.tagline.split(/(?<=\.) /);
  return (
    <section
      aria-labelledby="discover-hero-title"
      className="relative overflow-hidden rounded-[1.75rem] bg-mint-soft px-5 py-5 lg:px-6"
    >
      {/* Decorative pastel shapes; not data. */}
      <span aria-hidden className="absolute -top-10 -right-8 size-30 rounded-full bg-sky" />
      <span
        aria-hidden
        className="absolute right-16 -bottom-9 size-18 rounded-full bg-accent-soft"
      />
      <span aria-hidden className="absolute top-6 right-30 size-2.5 rounded-full bg-surface" />
      <div className="relative flex items-center gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h2
            id="discover-hero-title"
            className="font-display text-[1.3rem] leading-tight font-extrabold tracking-tight text-ink lg:text-2xl"
          >
            {first}
            {rest.length > 0 && (
              <>
                <br />
                {rest.join(" ")}
              </>
            )}
          </h2>
          <p className="text-[13px] leading-relaxed font-light text-slate-strong">
            ค้นหาหุ้นสหรัฐฯ ดูภาพรวมตลาด และเก็บหุ้นที่สนใจไว้ใกล้ ๆ ตัว
          </p>
          <MarketStatusPill className="mt-1.5" />
        </div>
        <Mascot size={88} className="animate-bob will-change-transform lg:size-24" />
      </div>
    </section>
  );
}
