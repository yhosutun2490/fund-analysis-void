import { Hono } from "hono";
import { z } from "zod";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../bindings";
import { listFullGroups, listMatchedKeys, type ScreenFilters } from "../repositories/funds";
import { screenGroups, type Window } from "../screen";
import { csvList, rangeNum, splitCsv, validate } from "../validation";

export const screen = new Hono<{ Bindings: Env }>();

const WINDOWS = ["3m", "6m", "1y"] as const satisfies readonly Window[];
const windowsError = "weakWindows 僅允許 3m/6m/1y（逗號分隔）";

/** /api/screen 的輸入契約。範圍參數至少擇一;數值參數未給用預設。 */
const ScreenQuery = z
  .object({
    category: csvList,
    area: csvList,
    group: csvList,
    domicile: csvList,
    currency: csvList,
    maxRr: rangeNum("maxRr", 1, 5).optional(),
    minSharpePct: rangeNum("minSharpePct", 0, 100).default(50),
    minDropPct: rangeNum("minDropPct", 0, 100).default(40),
    minWins: rangeNum("minWins", 0, 5).default(3),
    weakPct: rangeNum("weakPct", 0, 100).default(40),
    weakWindows: z
      .string()
      .transform(splitCsv)
      .pipe(z.array(z.enum(WINDOWS, { error: windowsError })).min(1, { error: windowsError }))
      .default(["6m", "1y"]),
    limit: rangeNum("limit", 1, 500).default(100),
  })
  .refine((q) => q.category || q.area || q.group, { error: "category / area / group 至少擇一（決定篩選範圍）" });

// 快照初篩：範圍篩選決定回傳哪些基金;百分位永遠以完整 (category,currency) 組計算
screen.get("/", validate("query", ScreenQuery), async (c) => {
  const { minSharpePct, minDropPct, minWins, weakPct, weakWindows, limit, ...q } = c.req.valid("query");
  const filters: ScreenFilters = {
    categories: q.category,
    areas: q.area,
    groups: q.group,
    domiciles: q.domicile,
    currencies: q.currency,
    maxRr: q.maxRr,
  };

  // 1) 篩選出命中的基金 → matched 集合與涉及的 categories
  const keys = await listMatchedKeys(c.env.DB, filters);
  const matchedIds = new Set(keys.map((k) => k.fund_id));
  const categories = [...new Set(keys.map((k) => k.category).filter((x): x is string => !!x))];

  // 2) 以完整組（按 category 取,不套其他篩選）計算百分位,只保留有命中的組
  const fullRows = await listFullGroups(c.env.DB, categories);
  const groups = screenGroups(fullRows, { minSharpePct, minDropPct, minWins, weakPct, weakWindows }, matchedIds).map(
    (g) => ({ ...g, passed: g.passed.slice(0, limit) }),
  );

  return c.json({
    filters,
    groups,
    params: { minSharpePct, minDropPct, minWins, weakPct, weakWindows },
    basis: "anue_year_fields_unverified",
    disclaimer: DISCLAIMER,
  });
});
