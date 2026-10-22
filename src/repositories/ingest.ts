import type { BatchItem } from "drizzle-orm/batch";
import { desc, eq } from "drizzle-orm";
import type { FundRecord } from "../anue";
import { makeDb } from "../db/client";
import { fundRisk, funds, ingestRuns } from "../db/schema";
import { runCols } from "../db/selections";

/** 把一批正規化記錄寫入 D1。funds 覆蓋更新;fund_risk 以 (fund_id, as_of) upsert 累積月歷史。 */
export async function upsertRecords(db: D1Database, records: FundRecord[]): Promise<number> {
  const drizzle = makeDb(db);
  const now = new Date().toISOString();

  const batch: BatchItem<"sqlite">[] = [];
  let upserted = 0;

  for (const rec of records) {
    const f = rec.fund;
    const fv = {
      fundId: f.fund_id, isin: f.isin, lipperId: f.lipper_id, name: f.name,
      fundGroup: f.fund_group, category: f.category, currency: f.currency, domicile: f.domicile,
      rr: f.rr, esgScore: f.esg_score, setupDate: f.setup_date, aumTwd: f.aum_twd, updatedAt: now,
    };
    batch.push(
      drizzle.insert(funds).values(fv).onConflictDoUpdate({
        target: funds.fundId,
        // 不覆寫 investment_area（由另一步驟維護）
        set: { isin: fv.isin, lipperId: fv.lipperId, name: fv.name, fundGroup: fv.fundGroup, category: fv.category, currency: fv.currency, domicile: fv.domicile, rr: fv.rr, esgScore: fv.esgScore, setupDate: fv.setupDate, aumTwd: fv.aumTwd, updatedAt: fv.updatedAt },
      }),
    );

    // 沒有資料截至日就跳過風險快照（不得以空值佔位）
    const asOf = rec.risk.as_of;
    if (asOf) {
      const k = rec.risk;
      const rv = {
        fundId: f.fund_id, asOf, std1y: k.std_1y, sharpe1y: k.sharpe_1y, sharpe3y: k.sharpe_3y,
        sharpe5y: k.sharpe_5y, sharpe10y: k.sharpe_10y, ret3m: k.ret_3m, ret6m: k.ret_6m, ret1y: k.ret_1y,
        ret3y: k.ret_3y, ret5y: k.ret_5y, roiY1: k.roi_y1, roiY2: k.roi_y2, roiY3: k.roi_y3, roiY4: k.roi_y4, roiY5: k.roi_y5,
        maxdropY1: k.maxdrop_y1, maxdropY2: k.maxdrop_y2, maxdropY3: k.maxdrop_y3, maxdropY4: k.maxdrop_y4, maxdropY5: k.maxdrop_y5,
        lipperTotal: k.lipper_total, nav: k.nav, navDate: k.nav_date, ingestedAt: now,
      };
      const { fundId: _f, asOf: _a, ...riskUpdate } = rv;
      batch.push(drizzle.insert(fundRisk).values(rv).onConflictDoUpdate({ target: [fundRisk.fundId, fundRisk.asOf], set: riskUpdate }));
      upserted++;
    }
  }

  // D1 batch 一次上限較小,分塊送
  const CHUNK = 50;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    if (slice.length) await drizzle.batch(slice as [(typeof slice)[number], ...(typeof slice)[number][]]);
  }
  return upserted;
}

/** 更新各基金的投資區域（funds.investment_area）。回傳更新筆數。 */
export async function updateInvestmentAreas(db: D1Database, areaOf: Map<string, string>): Promise<number> {
  const drizzle = makeDb(db);
  const stmts = [...areaOf].map(([id, area]) =>
    drizzle.update(funds).set({ investmentArea: area }).where(eq(funds.fundId, id)),
  );
  const CHUNK = 50;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    const slice = stmts.slice(i, i + CHUNK);
    if (slice.length) await drizzle.batch(slice as [(typeof slice)[number], ...(typeof slice)[number][]]);
  }
  return stmts.length;
}

export async function recordRun(
  db: D1Database,
  run: { started_at: string; finished_at: string; data_time: string | null; total_count: number; upserted: number; status: string; note?: string },
): Promise<void> {
  await makeDb(db).insert(ingestRuns).values({
    startedAt: run.started_at, finishedAt: run.finished_at, dataTime: run.data_time,
    totalCount: run.total_count, upserted: run.upserted, status: run.status, note: run.note ?? null,
  });
}

export async function listRuns(db: D1Database) {
  return makeDb(db)
    .select(runCols)
    .from(ingestRuns)
    .orderBy(desc(ingestRuns.id))
    .limit(20);
}
