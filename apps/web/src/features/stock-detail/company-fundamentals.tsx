"use client";

import type { ReactNode } from "react";

import { ApiErrorState } from "@/components/market/api-error-state";
import { Card, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StateMessage } from "@/components/ui/state-message";
import { cn } from "@/lib/cn";
import {
  EMPTY,
  direction,
  formatCalendarDate,
  formatCompact,
  formatMarketTime,
  formatNumber,
  formatSignedPercent,
} from "@/lib/format";
import { vendorLabel } from "@/lib/providers";
import { isApiError } from "@/services/api/client";
import { useFundamentals } from "@/services/api/queries";
import type { Freshness, Fundamentals, KeyMetrics } from "@/types/api";

interface Row {
  label: string;
  value: ReactNode;
  /** The number behind value; rows without one are left out. */
  raw: number | null;
  /** Signed values are coloured green or red by their sign. */
  tone?: "signed";
  className?: string;
}

const isNum = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

const money = (v: number | null) => (isNum(v) ? `$${formatCompact(v)}` : EMPTY);
const ratio = (v: number | null) => formatNumber(v);
const percent = (v: number | null) => (isNum(v) ? `${formatNumber(v)}%` : EMPTY);

/** A value with a muted second line, e.g. the S&P 500's return under the stock's. */
function WithNote({ value, note }: { value: string; note: string | false }) {
  return (
    <>
      {value}
      {note && <span className="block text-[11px] font-normal text-slate">{note}</span>}
    </>
  );
}

/** "rocketlabcorp.com" from "https://rocketlabcorp.com/". */
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function metricGroups(m: KeyMetrics): { title: string; rows: Row[] }[] {
  // P/E is undefined for a loss maker; the vendor reports null, which reads as missing data.
  const loss = !isNum(m.peTTM) && isNum(m.epsTTM) && m.epsTTM < 0;
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: "ผลตอบแทนราคา",
      rows: [
        {
          label: "ตั้งแต่ต้นปี",
          value: (
            <WithNote
              value={formatSignedPercent(m.priceReturnYTD)}
              note={isNum(m.sp500ReturnYTD) && `S&P 500 ${formatSignedPercent(m.sp500ReturnYTD)}`}
            />
          ),
          raw: m.priceReturnYTD,
          tone: "signed",
        },
        {
          label: "1 ปี",
          value: (
            <WithNote
              value={formatSignedPercent(m.priceReturn1Y)}
              note={isNum(m.sp500Return1Y) && `S&P 500 ${formatSignedPercent(m.sp500Return1Y)}`}
            />
          ),
          raw: m.priceReturn1Y,
          tone: "signed",
        },
        {
          label: "สูงสุด 52 สัปดาห์",
          value: (
            <WithNote
              value={formatNumber(m.fiftyTwoWeekHigh)}
              note={!!m.fiftyTwoWeekHighDate && formatCalendarDate(m.fiftyTwoWeekHighDate)}
            />
          ),
          raw: m.fiftyTwoWeekHigh,
        },
        {
          label: "ต่ำสุด 52 สัปดาห์",
          value: (
            <WithNote
              value={formatNumber(m.fiftyTwoWeekLow)}
              note={!!m.fiftyTwoWeekLowDate && formatCalendarDate(m.fiftyTwoWeekLowDate)}
            />
          ),
          raw: m.fiftyTwoWeekLow,
        },
      ],
    },
    {
      title: "มูลค่าบริษัท",
      rows: [
        { label: "มูลค่าตลาด", value: money(m.marketCap), raw: m.marketCap },
        { label: "มูลค่ากิจการ (EV)", value: money(m.enterpriseValue), raw: m.enterpriseValue },
        {
          label: "P/E",
          value: loss ? "ขาดทุน" : ratio(m.peTTM),
          raw: m.peTTM ?? m.epsTTM,
          className: loss ? "font-medium text-ink" : undefined,
        },
        { label: "P/S", value: ratio(m.psTTM), raw: m.psTTM },
        { label: "P/B", value: ratio(m.pb), raw: m.pb },
        { label: "EPS", value: ratio(m.epsTTM), raw: m.epsTTM, tone: "signed" },
      ],
    },
    {
      title: "การเติบโต",
      rows: [
        {
          label: "รายได้ เทียบปีก่อน",
          value: formatSignedPercent(m.revenueGrowthYoY),
          raw: m.revenueGrowthYoY,
          tone: "signed",
        },
        {
          label: "รายได้ เฉลี่ยต่อปี 5 ปี",
          value: formatSignedPercent(m.revenueGrowth5Y),
          raw: m.revenueGrowth5Y,
          tone: "signed",
        },
        {
          label: "EPS เทียบปีก่อน",
          value: formatSignedPercent(m.epsGrowthYoY),
          raw: m.epsGrowthYoY,
          tone: "signed",
        },
      ],
    },
    {
      title: "ความสามารถทำกำไร",
      rows: [
        {
          label: "อัตรากำไรขั้นต้น",
          value: percent(m.grossMarginTTM),
          raw: m.grossMarginTTM,
          tone: "signed",
        },
        {
          label: "อัตรากำไรจากการดำเนินงาน",
          value: percent(m.operatingMarginTTM),
          raw: m.operatingMarginTTM,
          tone: "signed",
        },
        {
          label: "อัตรากำไรสุทธิ",
          value: percent(m.netMarginTTM),
          raw: m.netMarginTTM,
          tone: "signed",
        },
        { label: "ROE", value: percent(m.roeTTM), raw: m.roeTTM, tone: "signed" },
      ],
    },
    {
      title: "ฐานะการเงิน",
      rows: [
        { label: "สภาพคล่อง (Current ratio)", value: ratio(m.currentRatio), raw: m.currentRatio },
        { label: "หนี้สินต่อทุน (D/E)", value: ratio(m.debtToEquity), raw: m.debtToEquity },
      ],
    },
    {
      title: "ปันผลและความผันผวน",
      rows: [
        { label: "อัตราปันผล", value: percent(m.dividendYield), raw: m.dividendYield },
        { label: "สัดส่วนจ่ายปันผล", value: percent(m.payoutRatioTTM), raw: m.payoutRatioTTM },
        { label: "Beta", value: ratio(m.beta), raw: m.beta },
      ],
    },
  ];
  // Rows the vendor doesn't report are left out, and so are groups left empty.
  return groups
    .map((g) => ({ title: g.title, rows: g.rows.filter((r) => isNum(r.raw)) }))
    .filter((g) => g.rows.length > 0);
}

function profileRows(f: Fundamentals): { label: string; value: ReactNode }[] {
  const rows: { label: string; value: ReactNode }[] = [];
  if (f.industry) rows.push({ label: "กลุ่มอุตสาหกรรม", value: f.industry });
  if (f.ipoDate) rows.push({ label: "เข้าตลาดเมื่อ", value: formatCalendarDate(f.ipoDate) });
  if (isNum(f.sharesOutstanding)) {
    rows.push({
      label: "จำนวนหุ้น",
      value: (
        <>
          {formatCompact(f.sharesOutstanding)} <span className="font-normal">หุ้น</span>
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
          className="text-mint-deep underline-offset-2 hover:underline"
        >
          {hostname(f.website)}
        </a>
      ),
    });
  }
  return rows;
}

function DataList({ rows }: { rows: { label: string; value: ReactNode; className?: string }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map((r) => (
        <div
          key={r.label}
          className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5"
        >
          <dt className="font-light text-slate">{r.label}</dt>
          <dd className={cn("tabular text-right font-semibold", r.className ?? "text-ink")}>
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The value's classes. The colour classes are custom, so cn() can't resolve them against text-ink. */
function valueClass(row: Row): string | undefined {
  if (row.tone !== "signed") return row.className;
  const dir = direction(row.raw);
  return dir === "up" ? "text-up" : dir === "down" ? "text-down" : row.className;
}

/** "ข้อมูลจาก Finnhub · อัปเดต …", shared by the vendor-sourced cards. */
export function SourceNote({
  freshness,
  children,
}: {
  freshness: Freshness;
  children?: ReactNode;
}) {
  return (
    <p className="mt-3 text-[11px] leading-relaxed text-slate">
      {children && <>{children} · </>}
      ข้อมูลจาก {vendorLabel(freshness.provider)} · อัปเดต {formatMarketTime(freshness.fetchedAt)}
      {freshness.stale && " (ข้อมูลเก่า ผู้ให้บริการไม่ตอบสนอง)"}
    </p>
  );
}

/**
 * What the company does and how the market values it, from the vendor's profile and
 * ratios. Hidden rows mean the vendor did not report them (ETFs have almost none).
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
      <Card>
        <CardTitle className="mb-2">ข้อมูลบริษัท</CardTitle>
        {body}
      </Card>
    );
  }

  const profile = profileRows(data);
  const groups = metricGroups(data.metrics);
  const source = (
    <SourceNote freshness={data.freshness}>อัตราส่วนคิดจาก 12 เดือนล่าสุด (TTM)</SourceNote>
  );

  if (profile.length === 0 && groups.length === 0) {
    return (
      <Card>
        <CardTitle className="mb-2">ข้อมูลบริษัท</CardTitle>
        <StateMessage
          compact
          title="ไม่มีข้อมูลพื้นฐานของหลักทรัพย์นี้"
          description="ผู้ให้บริการข้อมูลไม่มีโปรไฟล์และอัตราส่วนทางการเงิน เช่น สำหรับกองทุน ETF"
        />
      </Card>
    );
  }

  return (
    <>
      {profile.length > 0 && (
        <Card>
          <CardTitle className="mb-2">เกี่ยวกับบริษัท</CardTitle>
          <DataList rows={profile} />
        </Card>
      )}
      {groups.length > 0 && (
        <Card>
          <CardTitle className="mb-2">ตัวเลขสำคัญ</CardTitle>
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.title}>
                <h3 className="mb-1.5 text-xs font-medium text-slate-strong">{g.title}</h3>
                <DataList
                  rows={g.rows.map((r) => ({
                    label: r.label,
                    value: r.value,
                    className: valueClass(r),
                  }))}
                />
              </div>
            ))}
          </div>
          {source}
        </Card>
      )}
    </>
  );
}
