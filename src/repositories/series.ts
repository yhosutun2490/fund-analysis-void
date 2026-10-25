import { eq } from "drizzle-orm";
import { makeDb } from "../db/client";
import { fundSeries } from "../db/schema";
import type { SeriesPoint } from "../domain/recovery";

export interface SeriesRow {
  fund_id: string;
  basis: string;
  series_start: string;
  series_end: string;
  points: string; // JSON [["YYYY-MM-DD", index], …]
  fetched_at: string;
  mdd: number | null;
  mdd_recovered: number | null;
  mdd_underwater_days: number | null;
  still_underwater_ratio: number | null;
  loss_prob_1y: number | null;
}

// 以 snake_case 別名輸出,維持既有 SeriesRow 形狀
const COLS = {
  fund_id: fundSeries.fundId,
  basis: fundSeries.basis,
  series_start: fundSeries.seriesStart,
  series_end: fundSeries.seriesEnd,
  points: fundSeries.points,
  fetched_at: fundSeries.fetchedAt,
  mdd: fundSeries.mdd,
  mdd_recovered: fundSeries.mddRecovered,
  mdd_underwater_days: fundSeries.mddUnderwaterDays,
  still_underwater_ratio: fundSeries.stillUnderwaterRatio,
  loss_prob_1y: fundSeries.lossProb1y,
} as const;

export async function getSeries(db: D1Database, fundId: string): Promise<SeriesRow | null> {
  const [row] = await makeDb(db).select(COLS).from(fundSeries).where(eq(fundSeries.fundId, fundId)).limit(1);
  return row ?? null;
}

export interface SeriesSummary {
  mdd?: number | null;
  mdd_recovered?: boolean | null;
  mdd_underwater_days?: number | null;
  still_underwater_ratio?: number | null;
  loss_prob_1y?: number | null;
}

/** 寫入（覆蓋）一檔的序列快取。摘要欄位可省略（ticket 10 寫入）。 */
export async function saveSeries(
  db: D1Database,
  s: { fund_id: string; basis: string; series_start: string; series_end: string; points: SeriesPoint[]; fetched_at: string },
  summary: SeriesSummary = {},
): Promise<void> {
  const values = {
    fundId: s.fund_id,
    basis: s.basis,
    seriesStart: s.series_start,
    seriesEnd: s.series_end,
    points: JSON.stringify(s.points),
    fetchedAt: s.fetched_at,
    mdd: summary.mdd ?? null,
    mddRecovered: summary.mdd_recovered == null ? null : summary.mdd_recovered ? 1 : 0,
    mddUnderwaterDays: summary.mdd_underwater_days ?? null,
    stillUnderwaterRatio: summary.still_underwater_ratio ?? null,
    lossProb1y: summary.loss_prob_1y ?? null,
  };
  const { fundId: _k, ...update } = values;
  await makeDb(db).insert(fundSeries).values(values).onConflictDoUpdate({ target: fundSeries.fundId, set: update });
}
