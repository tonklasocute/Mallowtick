import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";

/** Formatted price with a small raised currency symbol: <sup>$</sup>189.32. */
export function PriceText({
  value,
  currency,
  className,
}: {
  value: number | null;
  currency?: string;
  className?: string;
}) {
  const text = formatPrice(value, currency);
  const parts = /^([^\d-]+)(\d.*)$/.exec(text);
  return (
    <span className={cn("tabular", className)}>
      {parts ? (
        <>
          <sup className="relative top-[0.2em] mr-px align-top text-[0.55em]">{parts[1]}</sup>
          {parts[2]}
        </>
      ) : (
        text
      )}
    </span>
  );
}
