"use client";

import { ArrowUpRight, Building2, ChartColumn } from "lucide-react";
import type { ReactNode } from "react";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { cn } from "@/lib/cn";
import { formatCalendarDate, formatCompact, formatNumber, formatSignedPercent } from "@/lib/format";
import { isApiError } from "@/services/api/client";
import { useFundamentals } from "@/services/api/queries";
import type { Fundamentals, KeyMetrics } from "@/types/api";

import {
  barScale,
  CardHeading,
  DetailCard,
  DivergingBar,
  ICON_TONES,
  type IconTone,
  signedTextClass,
  SourceNote,
  Tile,
  TileGrid,
} from "./detail-ui";

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

const money = (v: number) => `$${formatCompact(v)}`;
const percent = (v: number) => `${formatNumber(v)}%`;

/** "rocketlabcorp.com" from "https://rocketlabcorp.com/". */
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ProfileCard({ f }: { f: Fundamentals }) {
  const rows: { label: string; value: ReactNode }[] = [];
  if (f.industry) {
    rows.push({
      label: "กลุ่มอุตสาหกรรม",
      value: (
        <span className="rounded-full bg-sky-soft px-2.5 py-1 font-sans text-xs font-medium text-sky-ink">
          {f.industry}
        </span>
      ),
    });
  }
  if (f.ipoDate) rows.push({ label: "เข้าตลาดเมื่อ", value: formatCalendarDate(f.ipoDate) });
  if (isNum(f.sharesOutstanding)) {
    rows.push({
      label: "จำนวนหุ้น",
      value: (
        <>
          {formatCompact(f.sharesOutstanding)} <span className="font-sans font-medium">หุ้น</span>
        </>
      ),
    });
  }
  if (f.website) {
    rows.push({
      label: "เว็บไซต์",
      value: (
        <a
          href={f.website}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-[5px] font-extrabold text-up hover:text-ink"
        >
          {hostname(f.website)}
          <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={2.4} />
        </a>
      ),
    });
  }
  if (rows.length === 0) return null;
  return (
    <DetailCard aria-label="เกี่ยวกับบริษัท">
      <CardHeading icon={Building2} tone="lavender" title="เกี่ยวกับบริษัท" />
      <dl className="flex flex-col">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center gap-3 border-b border-dashed border-line py-[11px] last:border-b-0"
          >
            <dt className="flex-1 text-[13px] text-slate">{r.label}</dt>
            <dd className="tabular font-display text-sm font-black text-ink">{r.value}</dd>
          </div>
        ))}
      </dl>
    </DetailCard>
  );
}

/** A section of the metrics card: a small glyph tile and its title. */
function Group({
  glyph,
  tone,
  title,
  children,
}: {
  glyph: string;
  tone: IconTone;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <h3 className="mt-1.5 flex items-center gap-2 text-[13.5px] font-medium text-ink">
        <span
          aria-hidden
          className={cn(
            "grid size-[22px] place-items-center rounded-lg font-display text-xs font-black",
            ICON_TONES[tone],
          )}
        >
          {glyph}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One labelled bar from the centre of its track, with the value on the right. */
function BarRow({
  who,
  value,
  scale,
  fill,
  valueClass,
  wide,
}: {
  who: string;
  value: number;
  scale: number;
  fill: string;
  valueClass: string;
  /** Profit rows have long Thai labels and sit on the white card. */
  wide?: boolean;
}) {
  return (
    <li
      className={cn(
        "grid items-center gap-2 font-display text-[11.5px] font-extrabold",
        wide ? "grid-cols-[118px_minmax(0,1fr)_62px]" : "grid-cols-[58px_minmax(0,1fr)_62px]",
      )}
    >
      <span className={wide ? "font-sans text-xs font-normal text-ink" : "text-slate"}>{who}</span>
      <DivergingBar
        value={value}
        scale={scale}
        fill={fill}
        track={wide ? "bg-cream-deep" : "bg-surface"}
      />
      <span className={cn("tabular text-right", valueClass)}>{formatSignedPercent(value)}</span>
    </li>
  );
}

/** The stock's return over a period against the S&P 500's. */
function ReturnCompare({
  title,
  symbol,
  stock,
  spx,
  scale,
}: {
  title: string;
  symbol: string;
  stock: number;
  spx: number | null;
  scale: number;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-cream-deep p-3">
      <h4 className="text-[12.5px] text-ink">{title}</h4>
      <ul className="flex flex-col gap-2">
        <BarRow
          who={symbol}
          value={stock}
          scale={scale}
          fill={stock >= 0 ? "bg-up-fill" : "bg-down-fill"}
          valueClass={signedTextClass(stock)}
        />
        {isNum(spx) && (
          <BarRow who="S&P 500" value={spx} scale={scale} fill="bg-spx" valueClass="text-ink" />
        )}
      </ul>
    </div>
  );
}

/**
 * Growth over a thousand percent is shown without decimals ("+2,257%"): the cents of a
 * four-digit percentage mean nothing and would not fit the tile.
 */
function formatGrowth(value: number): string {
  if (Math.abs(value) < 1000) return formatSignedPercent(value);
  const rounded = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(value);
  return `${rounded}%`;
}

/** The tile is about 130px wide on a phone; longer numbers step down so they stay on one line. */
function growthSize(text: string): string {
  if (text.length <= 7) return "text-2xl";
  return text.length <= 9 ? "text-xl" : "text-lg";
}

function GrowthTile({ label, value }: { label: string; value: number }) {
  const up = value >= 0;
  const text = formatGrowth(value);
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-2xl p-3",
        up ? "bg-mint-soft" : "bg-accent-soft",
      )}
    >
      <dt className="text-[11.5px] text-slate">{label}</dt>
      <dd
        className={cn(
          "tabular flex items-baseline gap-1 font-display font-black whitespace-nowrap",
          growthSize(text),
          up ? "text-up" : "text-down",
        )}
      >
        <span aria-hidden className="text-[0.7em]">
          {up ? "▲" : "▼"}
        </span>
        {text}
      </dd>
    </div>
  );
}

interface Stat {
  label: string;
  value: number | null;
  format: (v: number) => string;
  size?: "md" | "lg";
  signed?: boolean;
  sub?: string;
}

/** Tiles for the stats the vendor reported; the rest are left out rather than shown as "—". */
function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <TileGrid cols={2}>
      {stats.flatMap((s) =>
        isNum(s.value)
          ? [
              <Tile
                key={s.label}
                label={s.label}
                value={s.format(s.value)}
                size={s.size}
                sub={s.sub}
                valueClassName={s.signed ? signedTextClass(s.value) : undefined}
              />,
            ]
          : [],
      )}
    </TileGrid>
  );
}

const anyNum = (...values: (number | null)[]) => values.some(isNum);

function MetricsCard({ symbol, m, source }: { symbol: string; m: KeyMetrics; source: ReactNode }) {
  // P/E is undefined for a loss maker; the vendor reports null, which reads as missing data.
  const loss = !isNum(m.peTTM) && isNum(m.epsTTM) && m.epsTTM < 0;
  const returnScale = barScale([
    m.priceReturnYTD,
    m.priceReturn1Y,
    m.sp500ReturnYTD,
    m.sp500Return1Y,
  ]);
  const margins = [
    { label: "อัตรากำไรขั้นต้น", value: m.grossMarginTTM },
    { label: "กำไรจากการดำเนินงาน", value: m.operatingMarginTTM },
    { label: "อัตรากำไรสุทธิ", value: m.netMarginTTM },
    { label: "ROE", value: m.roeTTM },
  ].filter((r): r is { label: string; value: number } => isNum(r.value));
  const marginScale = barScale(margins.map((r) => r.value));
  const growth = [
    { label: "รายได้ เทียบปีก่อน", value: m.revenueGrowthYoY },
    { label: "รายได้ เฉลี่ยต่อปี 5 ปี", value: m.revenueGrowth5Y },
    { label: "EPS เทียบปีก่อน", value: m.epsGrowthYoY },
  ].filter((r): r is { label: string; value: number } => isNum(r.value));

  const groups: ReactNode[] = [];
  if (anyNum(m.priceReturnYTD, m.priceReturn1Y, m.fiftyTwoWeekHigh, m.fiftyTwoWeekLow)) {
    groups.push(
      <Group key="returns" glyph="↗" tone="sky" title="ผลตอบแทนราคา">
        {isNum(m.priceReturnYTD) && (
          <ReturnCompare
            title="ตั้งแต่ต้นปี"
            symbol={symbol}
            stock={m.priceReturnYTD}
            spx={m.sp500ReturnYTD}
            scale={returnScale}
          />
        )}
        {isNum(m.priceReturn1Y) && (
          <ReturnCompare
            title="1 ปี"
            symbol={symbol}
            stock={m.priceReturn1Y}
            spx={m.sp500Return1Y}
            scale={returnScale}
          />
        )}
        <StatTiles
          stats={[
            {
              label: "สูงสุด 52 สัปดาห์",
              value: m.fiftyTwoWeekHigh,
              format: (v) => formatNumber(v),
              sub: m.fiftyTwoWeekHighDate ? formatCalendarDate(m.fiftyTwoWeekHighDate) : undefined,
            },
            {
              label: "ต่ำสุด 52 สัปดาห์",
              value: m.fiftyTwoWeekLow,
              format: (v) => formatNumber(v),
              sub: m.fiftyTwoWeekLowDate ? formatCalendarDate(m.fiftyTwoWeekLowDate) : undefined,
            },
          ]}
        />
      </Group>,
    );
  }
  if (anyNum(m.marketCap, m.enterpriseValue, m.peTTM, m.psTTM, m.pb, m.epsTTM)) {
    groups.push(
      <Group key="valuation" glyph="$" tone="lavender" title="มูลค่าบริษัท">
        <StatTiles
          stats={[
            { label: "มูลค่าตลาด", value: m.marketCap, format: money, size: "lg" },
            { label: "มูลค่ากิจการ (EV)", value: m.enterpriseValue, format: money, size: "lg" },
            // A loss maker's P/E reads "ขาดทุน"; its tile is kept by passing the EPS.
            {
              label: "P/E",
              value: loss ? m.epsTTM : m.peTTM,
              format: (v) => (loss ? "ขาดทุน" : formatNumber(v)),
            },
            { label: "P/S", value: m.psTTM, format: (v) => formatNumber(v) },
            { label: "P/B", value: m.pb, format: (v) => formatNumber(v) },
            { label: "EPS", value: m.epsTTM, format: (v) => formatNumber(v), signed: true },
          ]}
        />
      </Group>,
    );
  }
  if (growth.length > 0) {
    groups.push(
      <Group key="growth" glyph="↑" tone="mint" title="การเติบโต">
        <dl className="grid grid-cols-2 gap-2">
          {growth.map((g) => (
            <GrowthTile key={g.label} label={g.label} value={g.value} />
          ))}
        </dl>
      </Group>,
    );
  }
  if (margins.length > 0) {
    groups.push(
      <Group key="margins" glyph="%" tone="pink" title="ความสามารถทำกำไร">
        <ul className="flex flex-col gap-2.5">
          {margins.map((r) => (
            <BarRow
              key={r.label}
              wide
              who={r.label}
              value={r.value}
              scale={marginScale}
              fill={r.value >= 0 ? "bg-up-fill" : "bg-down-fill"}
              valueClass={signedTextClass(r.value)}
            />
          ))}
        </ul>
      </Group>,
    );
  }
  if (anyNum(m.currentRatio, m.debtToEquity)) {
    groups.push(
      <Group key="health" glyph="≈" tone="sky" title="ฐานะการเงิน">
        <StatTiles
          stats={[
            {
              label: "สภาพคล่อง (Current ratio)",
              value: m.currentRatio,
              format: (v) => formatNumber(v),
            },
            { label: "หนี้สินต่อทุน (D/E)", value: m.debtToEquity, format: (v) => formatNumber(v) },
          ]}
        />
      </Group>,
    );
  }
  if (anyNum(m.dividendYield, m.payoutRatioTTM, m.beta)) {
    groups.push(
      <Group key="dividend" glyph="β" tone="honey" title="ปันผลและความผันผวน">
        <StatTiles
          stats={[
            { label: "อัตราปันผล", value: m.dividendYield, format: percent },
            { label: "สัดส่วนจ่ายปันผล", value: m.payoutRatioTTM, format: percent },
            { label: "Beta", value: m.beta, format: (v) => formatNumber(v) },
          ]}
        />
      </Group>,
    );
  }
  if (groups.length === 0) return null;
  return (
    <DetailCard aria-label="ตัวเลขสำคัญ">
      <CardHeading icon={ChartColumn} tone="honey" title="ตัวเลขสำคัญ" />
      {groups}
      {source}
    </DetailCard>
  );
}

/**
 * What the company does and how the market values it, from the vendor's profile and
 * ratios. Hidden values mean the vendor did not report them (ETFs have almost none).
 */
export function CompanyFundamentals({ symbol }: { symbol: string }) {
  const { data, error, isPending, refetch } = useFundamentals(symbol);

  if (isPending || !data) {
    let body: ReactNode;
    if (isPending) {
      body = (
        <div aria-busy="true" aria-label="กำลังโหลดข้อมูลบริษัท" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      );
    } else if (isApiError(error) && error.code === "provider_not_configured") {
      body = (
        <StateMessage
          compact
          title="ยังไม่ได้ตั้งค่าแหล่งข้อมูลบริษัท"
          description="ตั้งค่า FINNHUB_API_KEY ที่เซิร์ฟเวอร์ API ของ Mallowtick เพื่อดูข้อมูลพื้นฐานของบริษัท"
        />
      );
    } else {
      body = <ApiErrorState error={error} onRetry={() => void refetch()} compact />;
    }
    return (
      <DetailCard aria-label="ข้อมูลบริษัท">
        <CardHeading icon={Building2} tone="lavender" title="ข้อมูลบริษัท" />
        {body}
      </DetailCard>
    );
  }

  const profile = <ProfileCard f={data} />;
  const metrics = (
    <MetricsCard
      symbol={symbol}
      m={data.metrics}
      source={
        <SourceNote freshness={data.freshness}>อัตราส่วนคิดจาก 12 เดือนล่าสุด (TTM)</SourceNote>
      }
    />
  );
  const hasProfile = Boolean(
    data.industry || data.ipoDate || data.website || isNum(data.sharesOutstanding),
  );
  const hasMetrics = Object.values(data.metrics).some(
    (v) => typeof v === "number" && Number.isFinite(v),
  );

  if (!hasProfile && !hasMetrics) {
    return (
      <DetailCard aria-label="ข้อมูลบริษัท">
        <CardHeading icon={Building2} tone="lavender" title="ข้อมูลบริษัท" />
        <StateMessage
          compact
          title="ไม่มีข้อมูลพื้นฐานของหลักทรัพย์นี้"
          description="ผู้ให้บริการข้อมูลไม่มีโปรไฟล์และอัตราส่วนทางการเงิน เช่น สำหรับกองทุน ETF"
        />
      </DetailCard>
    );
  }

  return (
    <>
      {profile}
      {metrics}
    </>
  );
}
