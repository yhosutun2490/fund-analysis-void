import type { SeriesPoint } from "../recovery";

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

export function getSeries(db: D1Database, fundId: string): Promise<SeriesRow | null> {
  return db.prepare("SELECT * FROM fund_series WHERE fund_id = ?").bind(fundId).first<SeriesRow>();
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
  await db
    .prepare(
      `INSERT INTO fund_series
         (fund_id, basis, series_start, series_end, points, fetched_at,
          mdd, mdd_recovered, mdd_underwater_days, still_underwater_ratio, loss_prob_1y)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
       ON CONFLICT(fund_id) DO UPDATE SET
         basis=?2, series_start=?3, series_end=?4, points=?5, fetched_at=?6,
         mdd=?7, mdd_recovered=?8, mdd_underwater_days=?9, still_underwater_ratio=?10, loss_prob_1y=?11`,
    )
    .bind(
      s.fund_id, s.basis, s.series_start, s.series_end, JSON.stringify(s.points), s.fetched_at,
      summary.mdd ?? null,
      summary.mdd_recovered == null ? null : summary.mdd_recovered ? 1 : 0,
      summary.mdd_underwater_days ?? null,
      summary.still_underwater_ratio ?? null,
      summary.loss_prob_1y ?? null,
    )
    .run();
}
