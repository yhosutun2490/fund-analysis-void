// API 輸出的列形狀:snake_case 別名 → Drizzle 欄位。
// repository 以此 select,response schema 以此由 Drizzle schema 衍生（見 src/responses.ts）,兩邊不會漂移。
import { fundRisk, funds, ingestRuns } from "./schema";

/** funds 全欄位（GET /api/funds/:id 的 fund）。 */
export const fundCols = {
  fund_id: funds.fundId, isin: funds.isin, lipper_id: funds.lipperId, name: funds.name,
  fund_group: funds.fundGroup, category: funds.category, currency: funds.currency,
  domicile: funds.domicile, investment_area: funds.investmentArea, rr: funds.rr,
  esg_score: funds.esgScore, setup_date: funds.setupDate, aum_twd: funds.aumTwd, updated_at: funds.updatedAt,
} as const;

/** fund_risk 全欄位（latest_risk / history）。 */
export const riskCols = {
  fund_id: fundRisk.fundId, as_of: fundRisk.asOf, std_1y: fundRisk.std1y,
  sharpe_1y: fundRisk.sharpe1y, sharpe_3y: fundRisk.sharpe3y, sharpe_5y: fundRisk.sharpe5y, sharpe_10y: fundRisk.sharpe10y,
  ret_3m: fundRisk.ret3m, ret_6m: fundRisk.ret6m, ret_1y: fundRisk.ret1y, ret_3y: fundRisk.ret3y, ret_5y: fundRisk.ret5y,
  roi_y1: fundRisk.roiY1, roi_y2: fundRisk.roiY2, roi_y3: fundRisk.roiY3, roi_y4: fundRisk.roiY4, roi_y5: fundRisk.roiY5,
  maxdrop_y1: fundRisk.maxdropY1, maxdrop_y2: fundRisk.maxdropY2, maxdrop_y3: fundRisk.maxdropY3,
  maxdrop_y4: fundRisk.maxdropY4, maxdrop_y5: fundRisk.maxdropY5,
  lipper_total: fundRisk.lipperTotal, nav: fundRisk.nav, nav_date: fundRisk.navDate, ingested_at: fundRisk.ingestedAt,
} as const;

/** 基金清單一列（GET /api/funds;基本資料 join 最新快照）。 */
export const fundListCols = {
  fund_id: funds.fundId, name: funds.name, fund_group: funds.fundGroup, category: funds.category,
  currency: funds.currency, domicile: funds.domicile, rr: funds.rr, esg_score: funds.esgScore,
  aum_twd: funds.aumTwd, setup_date: funds.setupDate,
  as_of: fundRisk.asOf, std_1y: fundRisk.std1y, sharpe_1y: fundRisk.sharpe1y, sharpe_3y: fundRisk.sharpe3y,
  sharpe_5y: fundRisk.sharpe5y, sharpe_10y: fundRisk.sharpe10y, ret_1y: fundRisk.ret1y, ret_3y: fundRisk.ret3y,
  ret_5y: fundRisk.ret5y, maxdrop_y1: fundRisk.maxdropY1, lipper_total: fundRisk.lipperTotal,
  nav: fundRisk.nav, nav_date: fundRisk.navDate,
} as const;

/** 類別統計（GET /api/meta/categories,另加 count() 的 n）。 */
export const categoryCols = { category: funds.category, fund_group: funds.fundGroup } as const;

/** 執行紀錄（GET /api/meta/runs）。 */
export const runCols = {
  id: ingestRuns.id, started_at: ingestRuns.startedAt, finished_at: ingestRuns.finishedAt,
  data_time: ingestRuns.dataTime, total_count: ingestRuns.totalCount, upserted: ingestRuns.upserted,
  status: ingestRuns.status, note: ingestRuns.note,
} as const;
