// /api/funds 底下各端點的請求與回應契約。
// 回應描述既有輸出形狀,不改名、不增減欄位;strictObject 讓改名/多漏欄位都會被抓到。
// DB 列的部分由 select 子句衍生（rowOf,見 src/db/selections.ts）,再補上非 DB 欄位。
import { z } from "zod";
import { fundCols, fundListCols, riskCols, rowOf } from "../db/selections";
import { disclaimer } from "./shared";

// ── 請求 ───────────────────────────────────────────────────────

/** 空字串視同未給（如 GET / 端點範本中的 `minSharpe3y=`;不先處理的話 coerce 會把它變成 0）。 */
const blankAsMissing = <S extends z.ZodType>(schema: S) => z.preprocess((v) => (v === "" ? undefined : v), schema);

/** GET /api/funds 的 query。limit 超過 500 夾到 500;空值參數視同未給;未知 sort 由 repository 回退 sharpe_3y。 */
export const FundListQuery = z.object({
  group: z.string().optional(),
  category: z.string().optional(),
  currency: z.string().optional(),
  rr: z.string().optional(),
  domicile: z.string().optional(),
  minSharpe3y: blankAsMissing(z.coerce.number({ error: "minSharpe3y 須為數值" }).optional()),
  maxStd1y: blankAsMissing(z.coerce.number({ error: "maxStd1y 須為數值" }).optional()),
  sort: z.string().optional(),
  order: blankAsMissing(
    z
      .string()
      .toLowerCase()
      .pipe(z.enum(["asc", "desc"], { error: "order 僅允許 asc/desc" }))
      .default("desc"),
  ),
  limit: z.coerce
    .number({ error: "limit 須為非負整數" })
    .int()
    .min(0)
    .default(50)
    .transform((n) => Math.min(n, 500)),
  offset: z.coerce.number({ error: "offset 須為非負整數" }).int().min(0).default(0),
});

/** /api/funds/:id 系列的路徑參數。 */
export const FundIdParam = z.object({ id: z.string().min(1) });

/** GET /api/funds/:id/recovery 的 query。 */
export const RecoveryQuery = z
  .object({
    from: z.string({ error: "from 須為 YYYY-MM-DD" }).regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string({ error: "to 須為 YYYY-MM-DD" }).regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    minDepth: z.coerce.number({ error: "minDepth 須在 (0,100)" }).gt(0).lt(100).default(10),
    refresh: z
      .string()
      .optional()
      .transform((v) => v === "true"),
  })
  .refine((q) => !(q.from && q.to && q.from > q.to), { error: "from 不可晚於 to" });

// ── 回應 ───────────────────────────────────────────────────────

/** GET /api/funds。 */
export const FundListResponse = z.strictObject({
  count: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  disclaimer,
  funds: z.array(rowOf(fundListCols)),
});

/** GET /api/funds/:id。 */
export const FundDetailResponse = z.strictObject({
  fund: rowOf(fundCols),
  latest_risk: rowOf(riskCols).nullable(),
  disclaimer,
});

/** GET /api/funds/:id/history。 */
export const FundHistoryResponse = z.strictObject({
  fund_id: z.string(),
  count: z.number().int().nonnegative(),
  history: z.array(rowOf(riskCols)),
  disclaimer,
});

// GET /api/funds/:id/recovery（純計算,見 src/recovery.ts）。日期欄位皆為 YYYY-MM-DD 字串。

const Drawdown = z.strictObject({
  depth: z.number().nullable(),
  peak: z.string().nullable(),
  trough: z.string().nullable(),
  recovery: z.string().nullable(),
  recovered: z.boolean(),
  recovery_days: z.number().nullable(),
  underwater_days: z.number().nullable(),
  gap_to_peak: z.number().nullable(),
});

const Holding = z.union([
  z.strictObject({ loss_prob: z.number(), worst: z.number(), median: z.number() }),
  z.strictObject({ reason: z.literal("window_shorter_than_horizon") }),
]);

/** GET /api/funds/:id/recovery。 */
export const RecoveryResponse = z.strictObject({
  fund_id: z.string(),
  name: z.string().nullable(),
  currency: z.string().nullable(),
  basis: z.literal("total_return"),
  source: z.string(),
  series: z.strictObject({
    start: z.string(),
    end: z.string(),
    points: z.number().int().nonnegative(),
    fetched_at: z.string(),
    stale: z.boolean(),
  }),
  window: z.strictObject({ from: z.string(), to: z.string() }),
  mdd: Drawdown.nullable(),
  episodes: z.array(Drawdown),
  events: z.record(z.string(), z.union([Drawdown, z.strictObject({ reason: z.literal("not_covered") })])),
  lump_sum: z
    .strictObject({
      still_underwater_ratio: z.number().nullable(),
      longest_underwater_days: z.number().nullable(),
      longest_underwater_entry: z.string().nullable(),
      longest_underwater_open: z.boolean(),
      holding: z.strictObject({ "1y": Holding, "3y": Holding }),
    })
    .nullable(),
  recent: z
    .strictObject({ ret_3m: z.number().nullable(), ret_6m: z.number().nullable(), ret_1y: z.number().nullable() })
    .nullable(),
  reason: z.literal("series_too_short").optional(),
  warning: z.string().optional(),
  disclaimer,
});
