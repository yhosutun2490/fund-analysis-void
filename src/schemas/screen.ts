// GET /api/screen 的請求與回應契約（純計算,見 src/domain/screen.ts）。
import { z } from "zod";
import type { Window } from "../domain/screen";
import { disclaimer } from "./shared";

// ── 請求 ───────────────────────────────────────────────────────

export const WINDOWS = ["3m", "6m", "1y"] as const satisfies readonly Window[];
const windowsError = "weakWindows 僅允許 3m/6m/1y（逗號分隔）";

/** 逗號分隔 → 去空白、濾空。 */
const splitCsv = (raw: string) =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// .meta() 的 description/examples 只進 OpenAPI 文件（GET /openapi.json）,不影響驗證。
// meta 掛在 transform 前的 z.string() 上（input 端）:掛在後面時 toJSONSchema 會丟掉 examples / default。

/** 多值篩選參數：逗號分隔;無值（含只有逗號/空白）→ undefined。 */
const csvList = (meta: { description: string; examples: string[] }) =>
  z
    .string()
    .meta({ ...meta, description: `${meta.description}（逗號分隔可多選）` })
    .optional()
    .transform((raw) => {
      const xs = raw === undefined ? undefined : splitCsv(raw);
      return xs?.length ? xs : undefined;
    });

/** GET /api/screen 的 query。範圍參數至少擇一;數值參數未給用預設。 */
export const ScreenQuery = z
  .object({
    category: csvList({ description: "基金類別", examples: ["台灣股票"] }),
    area: csvList({ description: "投資區域", examples: ["亞洲"] }),
    group: csvList({ description: "基金類型", examples: ["股票型"] }),
    domicile: csvList({ description: "onshore（境內）/ offshore（境外）", examples: ["offshore"] }),
    currency: csvList({ description: "計價幣別", examples: ["TWD"] }),
    maxRr: z.coerce
      .number({ error: "maxRr 須為 1–5 的數值" })
      .min(1)
      .max(5)
      .optional()
      .meta({ description: "風險等級上限:只含 RR1 到 RR{maxRr}" }),
    minSharpePct: z.coerce
      .number({ error: "minSharpePct 須為 0–100 的數值" })
      .min(0)
      .max(100)
      .default(50)
      .meta({ description: "3 年 Sharpe 在同組的百分位下限" }),
    minDropPct: z.coerce
      .number({ error: "minDropPct 須為 0–100 的數值" })
      .min(0)
      .max(100)
      .default(40)
      .meta({ description: "近年最差年度跌幅在同組的百分位下限" }),
    minWins: z.coerce
      .number({ error: "minWins 須為 0–5 的數值" })
      .min(0)
      .max(5)
      .default(3)
      .meta({ description: "近 5 個年度中報酬贏同組中位數的最少年數" }),
    weakPct: z.coerce
      .number({ error: "weakPct 須為 0–100 的數值" })
      .min(0)
      .max(100)
      .default(40)
      .meta({ description: "weakWindows 各窗口的近期報酬百分位皆低於此值（且長期表現佳）時標記 weak_flag;只標記,不剔除" }),
    weakWindows: z
      .string()
      .meta({ description: "判斷轉弱的近期窗口:3m/6m/1y（逗號分隔可多選）", default: "6m,1y", examples: ["6m,1y"] })
      .transform(splitCsv)
      .pipe(z.array(z.enum(WINDOWS, { error: windowsError })).min(1, { error: windowsError }))
      .default(["6m", "1y"]),
    limit: z.coerce
      .number({ error: "limit 須為 1–500 的數值" })
      .min(1)
      .max(500)
      .default(100)
      .meta({ description: "每組 passed 最多回傳筆數" }),
  })
  .refine((q) => q.category || q.area || q.group, { error: "category / area / group 至少擇一（決定篩選範圍）" });

// ── 回應 ───────────────────────────────────────────────────────

const PassedFund = z.strictObject({
  fund_id: z.string(),
  name: z.string(),
  rr: z.string().nullable(),
  as_of: z.string().nullable(), // YYYY-MM-DD
  sharpe_pct: z.number().nullable(),
  worst_drop: z.number().nullable(),
  worst_drop_pct: z.number().nullable(),
  wins: z.number().int().nonnegative(),
  win_years: z.number().int().nonnegative(),
  ladder: z.strictObject({
    ret_3m_pct: z.number().nullable(),
    ret_6m_pct: z.number().nullable(),
    ret_1y_pct: z.number().nullable(),
  }),
  weak_flag: z.boolean().nullable(),
  reasons: z.array(z.string()),
  recovery: z
    .strictObject({
      mdd: z.number().nullable(),
      mdd_recovered: z.boolean().nullable(),
      mdd_underwater_days: z.number().nullable(),
      still_underwater_ratio: z.number().nullable(),
      loss_prob_1y: z.number().nullable(),
      series_end: z.string(), // YYYY-MM-DD
    })
    .nullable(),
});

const ScreenGroup = z.strictObject({
  category: z.string().nullable(),
  currency: z.string().nullable(),
  peer_count: z.number().int().nonnegative(),
  matched_count: z.number().int().nonnegative(),
  passed: z.array(PassedFund),
  rejected_count: z.number().int().nonnegative(),
  insufficient: z.array(
    z.strictObject({
      fund_id: z.string(),
      name: z.string(),
      reason: z.enum(["peer_group_too_small", "missing_sharpe_3y", "fewer_than_3_years"]),
    }),
  ),
});

export const ScreenResponse = z.strictObject({
  filters: z.strictObject({
    categories: z.array(z.string()).optional(),
    areas: z.array(z.string()).optional(),
    groups: z.array(z.string()).optional(),
    domiciles: z.array(z.string()).optional(),
    currencies: z.array(z.string()).optional(),
    maxRr: z.number().optional(),
  }),
  groups: z.array(ScreenGroup),
  params: z.strictObject({
    minSharpePct: z.number(),
    minDropPct: z.number(),
    minWins: z.number(),
    weakPct: z.number(),
    weakWindows: z.array(z.enum(WINDOWS)),
  }),
  basis: z.literal("anue_year_fields_unverified"),
  disclaimer,
});
