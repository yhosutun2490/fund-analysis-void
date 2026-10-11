import { fetchTotalReturnSeries } from "../anuePrice";
import type { Env } from "../env";
import type { SeriesPoint } from "../recovery";
import { getLatestRisk } from "../repositories/funds";
import { getSeries, type SeriesRow, saveSeries } from "../repositories/series";

/** 上游無法取得且無快取可用 → 路由回 502。 */
export class UpstreamUnavailable extends Error {}

export interface LoadedSeries {
  points: SeriesPoint[];
  start: string;
  end: string;
  fetched_at: string;
  stale: boolean;
  warning?: string;
}

const DAY_MS = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 新鮮：series_end ≥ 最新快照 nav_date;nav_date 未知時 fetched_at 在 24 小時內。 */
function isFresh(cached: SeriesRow, navDate: string | null): boolean {
  if (navDate) return cached.series_end >= navDate;
  return Date.now() - Date.parse(cached.fetched_at) < DAY_MS;
}

const fromCache = (c: SeriesRow, stale: boolean, warning?: string): LoadedSeries => ({
  points: JSON.parse(c.points) as SeriesPoint[],
  start: c.series_start,
  end: c.series_end,
  fetched_at: c.fetched_at,
  stale,
  warning,
});

/**
 * 取得含息序列：快取新鮮則直接用,否則整條重抓並存檔。
 * 上游失敗時有快取 → 回快取並標 stale;無快取 → 丟 UpstreamUnavailable（502）。
 */
async function persist(db: D1Database, fundId: string, points: SeriesPoint[], fetched_at: string): Promise<LoadedSeries> {
  const start = points[0][0];
  const end = points[points.length - 1][0];
  await saveSeries(db, { fund_id: fundId, basis: "total_return", series_start: start, series_end: end, points, fetched_at });
  return { points, start, end, fetched_at, stale: false };
}

export async function loadSeries(
  env: Env,
  fund: { fund_id: string; setup_date?: string | null },
  opts: { refresh?: boolean } = {},
): Promise<LoadedSeries> {
  const db = env.DB;
  const cached = await getSeries(db, fund.fund_id);
  const latest = (await getLatestRisk(db, fund.fund_id)) as { nav_date?: string | null } | null;
  const navDate = latest?.nav_date ?? null;

  if (cached && !opts.refresh && isFresh(cached, navDate)) return fromCache(cached, false);

  // 過期且有快取（非 refresh）：先試增量,只補抓 [series_end, 今天] 一段並串接
  if (cached && !opts.refresh) {
    try {
      const inc = await fetchTotalReturnSeries(fund.fund_id, cached.series_end, today());
      // 增量首點須等於 series_end 才接得上,否則整條重抓
      if (inc.length >= 1 && inc[0][0] === cached.series_end) {
        const base = JSON.parse(cached.points) as SeriesPoint[];
        const carry = base[base.length - 1][1];
        const tail: SeriesPoint[] = inc.slice(1).map(([d, idx]) => [d, carry * idx]);
        return await persist(db, fund.fund_id, [...base, ...tail], new Date().toISOString());
      }
      // 接不上 → 落到整條重抓
    } catch (e) {
      return fromCache(cached, true, `增量更新失敗,沿用快取: ${msg(e)}`);
    }
  }

  // 整條重抓（refresh、無快取,或增量接不上）
  const from = fund.setup_date || "1990-01-01";
  try {
    const points = await fetchTotalReturnSeries(fund.fund_id, from, today());
    if (points.length === 0) {
      if (cached) return fromCache(cached, true, "上游無資料,沿用快取");
      // 無資料也無快取：回空序列,由路由判為 series_too_short
      return { points: [], start: from, end: today(), fetched_at: new Date().toISOString(), stale: false };
    }
    return await persist(db, fund.fund_id, points, new Date().toISOString());
  } catch (e) {
    if (cached) return fromCache(cached, true, `上游失敗,沿用快取: ${msg(e)}`);
    throw new UpstreamUnavailable(msg(e));
  }
}
