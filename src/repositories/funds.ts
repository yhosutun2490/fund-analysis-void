import { type AnyColumn, and, asc, count, desc, eq, gte, inArray, lte, max, type SQL, sql } from "drizzle-orm";
import { makeDb } from "../db/client";
import { fundRisk, funds, fundSeries } from "../../db/schema";
import { categoryCols, fundCols, fundListCols, riskCols } from "../db/selections";
import type { ScreenRow } from "../domain/screen";

export interface FundListQuery {
  group?: string;
  category?: string;
  currency?: string;
  rr?: string;
  domicile?: string;
  minSharpe3y?: number;
  maxStd1y?: number;
  sort?: string;
  order: "ASC" | "DESC";
  limit: number;
  offset: number;
}

const SORTABLE: Record<string, AnyColumn> = {
  sharpe_3y: fundRisk.sharpe3y,
  sharpe_1y: fundRisk.sharpe1y,
  std_1y: fundRisk.std1y,
  ret_3y: fundRisk.ret3y,
  ret_1y: fundRisk.ret1y,
  aum_twd: funds.aumTwd,
};

/** 以最新 as_of 的風險快照 join 基金基本資料的 CTE（最新一筆）。 */
function latestCte(db: ReturnType<typeof makeDb>) {
  return db.$with("latest").as(
    db.select({ fundId: fundRisk.fundId, latestAsOf: max(fundRisk.asOf).as("latest_as_of") }).from(fundRisk).groupBy(fundRisk.fundId),
  );
}

/** 基金清單 + 篩選 + 排序（以最新快照） */
export async function listFunds(db: D1Database, q: FundListQuery) {
  const drizzle = makeDb(db);
  const latest = latestCte(drizzle);

  const conds: SQL[] = [];
  if (q.group) conds.push(eq(funds.fundGroup, q.group));
  if (q.category) conds.push(eq(funds.category, q.category));
  if (q.currency) conds.push(eq(funds.currency, q.currency));
  if (q.rr) conds.push(eq(funds.rr, q.rr));
  if (q.domicile) conds.push(eq(funds.domicile, q.domicile));
  if (q.minSharpe3y !== undefined) conds.push(gte(fundRisk.sharpe3y, q.minSharpe3y));
  if (q.maxStd1y !== undefined) conds.push(lte(fundRisk.std1y, q.maxStd1y));

  const sortCol = SORTABLE[q.sort ?? "sharpe_3y"] ?? fundRisk.sharpe3y;
  const dir = q.order === "ASC" ? asc(sortCol) : desc(sortCol);

  return drizzle
    .with(latest)
    .select(fundListCols)
    .from(funds)
    .innerJoin(latest, eq(latest.fundId, funds.fundId))
    .innerJoin(fundRisk, and(eq(fundRisk.fundId, funds.fundId), eq(fundRisk.asOf, latest.latestAsOf)))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${sortCol} is null`, dir)
    .limit(q.limit)
    .offset(q.offset);
}

export interface ScreenFilters {
  categories?: string[];
  areas?: string[];
  groups?: string[];
  domiciles?: string[];
  currencies?: string[];
  maxRr?: number;
}

/** 符合範圍篩選的基金 key（決定命中組與 matched 集合;同參數 OR、跨參數 AND）。 */
export async function listMatchedKeys(
  db: D1Database,
  f: ScreenFilters,
): Promise<{ fund_id: string; category: string | null; currency: string | null }[]> {
  const conds: SQL[] = [];
  if (f.categories?.length) conds.push(inArray(funds.category, f.categories));
  if (f.areas?.length) conds.push(inArray(funds.investmentArea, f.areas));
  if (f.groups?.length) conds.push(inArray(funds.fundGroup, f.groups));
  if (f.domiciles?.length) conds.push(inArray(funds.domicile, f.domiciles));
  if (f.currencies?.length) conds.push(inArray(funds.currency, f.currencies));
  if (f.maxRr !== undefined) {
    const rrs = Array.from({ length: f.maxRr }, (_, i) => `RR${i + 1}`);
    conds.push(inArray(funds.rr, rrs));
  }
  return makeDb(db)
    .select({ fund_id: funds.fundId, category: funds.category, currency: funds.currency })
    .from(funds)
    .where(conds.length ? and(...conds) : undefined);
}

/** 指定 categories 的完整組最新快照（不套其他篩選,作為百分位基準;left join fund_series 摘要）。 */
export async function listFullGroups(db: D1Database, categories: string[]): Promise<ScreenRow[]> {
  if (categories.length === 0) return [];
  const drizzle = makeDb(db);
  const latest = latestCte(drizzle);
  const rows = await drizzle
    .with(latest)
    .select({
      fund_id: funds.fundId, name: funds.name, category: funds.category, currency: funds.currency, rr: funds.rr,
      as_of: fundRisk.asOf, sharpe_3y: fundRisk.sharpe3y, ret_3m: fundRisk.ret3m, ret_6m: fundRisk.ret6m, ret_1y: fundRisk.ret1y,
      roi_y1: fundRisk.roiY1, roi_y2: fundRisk.roiY2, roi_y3: fundRisk.roiY3, roi_y4: fundRisk.roiY4, roi_y5: fundRisk.roiY5,
      maxdrop_y1: fundRisk.maxdropY1, maxdrop_y2: fundRisk.maxdropY2, maxdrop_y3: fundRisk.maxdropY3,
      maxdrop_y4: fundRisk.maxdropY4, maxdrop_y5: fundRisk.maxdropY5,
      rec_series_end: fundSeries.seriesEnd, rec_mdd: fundSeries.mdd, rec_mdd_recovered: fundSeries.mddRecovered,
      rec_mdd_underwater_days: fundSeries.mddUnderwaterDays, rec_still_underwater_ratio: fundSeries.stillUnderwaterRatio,
      rec_loss_prob_1y: fundSeries.lossProb1y,
    })
    .from(funds)
    .innerJoin(latest, eq(latest.fundId, funds.fundId))
    .innerJoin(fundRisk, and(eq(fundRisk.fundId, funds.fundId), eq(fundRisk.asOf, latest.latestAsOf)))
    .leftJoin(fundSeries, eq(fundSeries.fundId, funds.fundId))
    .where(inArray(funds.category, categories));
  return rows as ScreenRow[];
}

export async function getFund(db: D1Database, id: string) {
  const [row] = await makeDb(db).select(fundCols).from(funds).where(eq(funds.fundId, id)).limit(1);
  return row ?? null;
}

export async function getLatestRisk(db: D1Database, id: string) {
  const [row] = await makeDb(db).select(riskCols).from(fundRisk).where(eq(fundRisk.fundId, id)).orderBy(desc(fundRisk.asOf)).limit(1);
  return row ?? null;
}

/** 單檔風險歷史（cron 累積出來的月序列） */
export async function getRiskHistory(db: D1Database, id: string) {
  return makeDb(db).select(riskCols).from(fundRisk).where(eq(fundRisk.fundId, id)).orderBy(asc(fundRisk.asOf));
}

export async function listCategories(db: D1Database) {
  return makeDb(db)
    .select({ ...categoryCols, n: count() })
    .from(funds)
    .where(sql`${funds.category} is not null`)
    .groupBy(funds.category)
    .orderBy(desc(count()));
}
