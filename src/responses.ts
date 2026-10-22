// 各路由成功（與已知錯誤）回應的 zod schema = API 輸出契約的唯一真相來源。
// DB 列的部分由 Drizzle schema 衍生（drizzle-zod）,再補上非 DB 欄位（disclaimer、計算欄、包裝）。
// 描述的是既有輸出形狀,不改名、不增減欄位;strictObject 讓改名/多漏欄位都會被抓到。
import { type Column, getTableColumns, type Table } from "drizzle-orm";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { categoryCols, fundCols, fundListCols, riskCols, runCols } from "./db/selections";
import { DISCLAIMER } from "./disclaimer";

// ── Drizzle 衍生 ────────────────────────────────────────────────

// createSelectSchema 以 TS 屬性名（camelCase）為鍵;改以 Column 物件索引,供 snake_case 別名查詢
const columnSchemas = new WeakMap<Table, Map<Column, z.ZodType>>();

function columnSchema(col: Column): z.ZodType {
  let byCol = columnSchemas.get(col.table);
  if (!byCol) {
    const shape = createSelectSchema(col.table).shape as Record<string, z.ZodType>;
    byCol = new Map(Object.entries(getTableColumns(col.table)).map(([key, c]) => [c, shape[key]]));
    columnSchemas.set(col.table, byCol);
  }
  return byCol.get(col)!;
}

/** 由 snake_case 選欄（別名 → Drizzle 欄位）衍生一列的 schema。 */
const rowOf = <S extends Record<string, Column>>(selection: S) =>
  z.strictObject(
    Object.fromEntries(Object.entries(selection).map(([alias, col]) => [alias, columnSchema(col)])) as {
      [K in keyof S]: z.ZodType;
    },
  );

// ── 共用片段 ───────────────────────────────────────────────────

const disclaimer = z.literal(DISCLAIMER);
const count = z.number().int().nonnegative();
const date = z.string(); // YYYY-MM-DD
const numN = z.number().nullable();

/** 請求錯誤（400/404/502）的一致形狀。 */
export const ErrorResponse = z.strictObject({ error: z.string() });

// ── GET / ──────────────────────────────────────────────────────

export const RootResponse = z.strictObject({
  name: z.string(),
  kind: z.string(),
  endpoints: z.array(z.string()),
  disclaimer,
});

// ── /api/funds ─────────────────────────────────────────────────

export const FundListResponse = z.strictObject({
  count,
  limit: count,
  offset: count,
  disclaimer,
  funds: z.array(rowOf(fundListCols)),
});

export const FundDetailResponse = z.strictObject({
  fund: rowOf(fundCols),
  latest_risk: rowOf(riskCols).nullable(),
  disclaimer,
});

export const FundHistoryResponse = z.strictObject({
  fund_id: z.string(),
  count,
  history: z.array(rowOf(riskCols)),
  disclaimer,
});

// ── /api/funds/:id/recovery（純計算,見 src/recovery.ts）──────────

const Drawdown = z.strictObject({
  depth: numN,
  peak: date.nullable(),
  trough: date.nullable(),
  recovery: date.nullable(),
  recovered: z.boolean(),
  recovery_days: numN,
  underwater_days: numN,
  gap_to_peak: numN,
});

const Holding = z.union([
  z.strictObject({ loss_prob: z.number(), worst: z.number(), median: z.number() }),
  z.strictObject({ reason: z.literal("window_shorter_than_horizon") }),
]);

export const RecoveryResponse = z.strictObject({
  fund_id: z.string(),
  name: z.string().nullable(),
  currency: z.string().nullable(),
  basis: z.literal("total_return"),
  source: z.string(),
  series: z.strictObject({ start: date, end: date, points: count, fetched_at: z.string(), stale: z.boolean() }),
  window: z.strictObject({ from: date, to: date }),
  mdd: Drawdown.nullable(),
  episodes: z.array(Drawdown),
  events: z.record(z.string(), z.union([Drawdown, z.strictObject({ reason: z.literal("not_covered") })])),
  lump_sum: z
    .strictObject({
      still_underwater_ratio: numN,
      longest_underwater_days: numN,
      longest_underwater_entry: date.nullable(),
      longest_underwater_open: z.boolean(),
      holding: z.strictObject({ "1y": Holding, "3y": Holding }),
    })
    .nullable(),
  recent: z.strictObject({ ret_3m: numN, ret_6m: numN, ret_1y: numN }).nullable(),
  reason: z.literal("series_too_short").optional(),
  warning: z.string().optional(),
  disclaimer,
});

// ── /api/screen（純計算,見 src/screen.ts）────────────────────────

const PassedFund = z.strictObject({
  fund_id: z.string(),
  name: z.string(),
  rr: z.string().nullable(),
  as_of: date.nullable(),
  sharpe_pct: numN,
  worst_drop: numN,
  worst_drop_pct: numN,
  wins: count,
  win_years: count,
  ladder: z.strictObject({ ret_3m_pct: numN, ret_6m_pct: numN, ret_1y_pct: numN }),
  weak_flag: z.boolean().nullable(),
  reasons: z.array(z.string()),
  recovery: z
    .strictObject({
      mdd: numN,
      mdd_recovered: z.boolean().nullable(),
      mdd_underwater_days: numN,
      still_underwater_ratio: numN,
      loss_prob_1y: numN,
      series_end: date,
    })
    .nullable(),
});

const ScreenGroup = z.strictObject({
  category: z.string().nullable(),
  currency: z.string().nullable(),
  peer_count: count,
  matched_count: count,
  passed: z.array(PassedFund),
  rejected_count: count,
  insufficient: z.array(
    z.strictObject({
      fund_id: z.string(),
      name: z.string(),
      reason: z.enum(["peer_group_too_small", "missing_sharpe_3y", "fewer_than_3_years"]),
    }),
  ),
});

const strList = z.array(z.string()).optional();

export const ScreenResponse = z.strictObject({
  filters: z.strictObject({
    categories: strList,
    areas: strList,
    groups: strList,
    domiciles: strList,
    currencies: strList,
    maxRr: z.number().optional(),
  }),
  groups: z.array(ScreenGroup),
  params: z.strictObject({
    minSharpePct: z.number(),
    minDropPct: z.number(),
    minWins: z.number(),
    weakPct: z.number(),
    weakWindows: z.array(z.enum(["3m", "6m", "1y"])),
  }),
  basis: z.literal("anue_year_fields_unverified"),
  disclaimer,
});

// ── /api/meta ──────────────────────────────────────────────────

export const CategoriesResponse = z.strictObject({
  categories: z.array(rowOf(categoryCols).extend({ n: count })),
});

export const RunsResponse = z.strictObject({ runs: z.array(rowOf(runCols)) });

// ── /admin/ingest ──────────────────────────────────────────────

export const AdminIngestOk = z.strictObject({
  status: z.literal("ok"),
  dataTime: z.string(),
  dataCount: count,
  fetched: count,
  upserted: count,
  note: z.string().optional(),
});

export const AdminIngestError = z.strictObject({ status: z.literal("error"), message: z.string() });
