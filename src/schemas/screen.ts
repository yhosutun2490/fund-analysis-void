// GET /api/screen 的請求與回應契約（純計算,見 src/screen.ts）。
import { z } from "zod";
import type { Window } from "../screen";
import { disclaimer } from "./shared";

// ── 請求 ───────────────────────────────────────────────────────

export const WINDOWS = ["3m", "6m", "1y"] as const satisfies readonly Window[];
const windowsError = "weakWindows 僅允許 3m/6m/1y（逗號分隔）";

/** 逗號分隔 → 去空白、濾空。 */
const csv = z.string().transform((raw) =>
  raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/** 多值篩選參數：逗號分隔;無值（含只有逗號/空白）→ undefined。 */
const csvList = csv.optional().transform((xs) => (xs?.length ? xs : undefined));

/** GET /api/screen 的 query。範圍參數至少擇一;數值參數未給用預設。 */
export const ScreenQuery = z
  .object({
    category: csvList,
    area: csvList,
    group: csvList,
    domicile: csvList,
    currency: csvList,
    maxRr: z.coerce.number({ error: "maxRr 須為 1–5 的數值" }).min(1).max(5).optional(),
    minSharpePct: z.coerce.number({ error: "minSharpePct 須為 0–100 的數值" }).min(0).max(100).default(50),
    minDropPct: z.coerce.number({ error: "minDropPct 須為 0–100 的數值" }).min(0).max(100).default(40),
    minWins: z.coerce.number({ error: "minWins 須為 0–5 的數值" }).min(0).max(5).default(3),
    weakPct: z.coerce.number({ error: "weakPct 須為 0–100 的數值" }).min(0).max(100).default(40),
    weakWindows: csv.pipe(z.array(z.enum(WINDOWS, { error: windowsError })).min(1, { error: windowsError })).default(["6m", "1y"]),
    limit: z.coerce.number({ error: "limit 須為 1–500 的數值" }).min(1).max(500).default(100),
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
