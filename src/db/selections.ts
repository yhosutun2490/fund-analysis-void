// API 輸出的列形狀（select 子句）:snake_case 別名 → Drizzle 欄位,以及「select 子句 → schema」的 rowOf。
// repository 以這些 select 子句查詢,回應 schema（src/responses.ts）以 rowOf(select 子句) 衍生,兩邊共用同一份定義,不會漂移。
import { type Column, getTableColumns, type Table } from "drizzle-orm";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { fundRisk, funds, ingestRuns } from "./schema";

// ── rowOf：select 子句 → schema ─────────────────────────────────
// 為什麼不直接用 drizzle-zod 的 createSelectSchema(table)?它描述的是「資料表的一列」（SELECT *）,
// 而 API 回傳的是「一次查詢的一列」,差在三點:
//   1. 鍵是 snake_case 別名（fund_id）,createSelectSchema 用 TS 屬性名（fundId）;
//   2. 只取部分欄位;
//   3. 可能跨表（如清單是 funds join fund_risk）。
// drizzle-zod 沒有「由 select 物件產生 schema」的 API,rowOf 補的就是這個缺口:
// 對每個別名,找出欄位所屬資料表的 createSelectSchema,取該欄位的 schema。

// 每張表一份 createSelectSchema 的 shape。不能拿掉:不快取時每個欄位都重跑一次 createSelectSchema（約 90 次）,
// 建出全部列 schema 要約 32 ms,會落在 Worker 冷啟動上;快取後只跑 3 次（每張表一次）。
const tableSchemas = new Map<Table, Record<string, z.ZodType>>();

/** select 子句（別名 → Drizzle 欄位）→ 該查詢一列的 schema（strictObject,鍵為別名）。 */
export const rowOf = <S extends Record<string, Column>>(selection: S) =>
  z.strictObject(
    Object.fromEntries(
      Object.entries(selection).map(([alias, col]) => {
        if (!tableSchemas.has(col.table)) tableSchemas.set(col.table, createSelectSchema(col.table).shape);
        const [key] = Object.entries(getTableColumns(col.table)).find(([, c]) => c === col)!;
        return [alias, tableSchemas.get(col.table)![key]];
      }),
    ) as { [K in keyof S]: z.ZodType },
  );

// ── select 子句 ────────────────────────────────────────────────

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
