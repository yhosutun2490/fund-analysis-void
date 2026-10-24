import { Hono } from "hono";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../bindings";
import { listFullGroups, listMatchedKeys, type ScreenFilters } from "../repositories/funds";
import { screenGroups } from "../screen";
import { ScreenQuery, ScreenResponse } from "../schemas/screen";
import { ErrorResponse } from "../schemas/shared";
import { responds, validate } from "../validation";

export const screen = new Hono<{ Bindings: Env }>();

// 快照初篩：範圍篩選決定回傳哪些基金;百分位永遠以完整 (category,currency) 組計算
screen.get("/", responds({ 200: ScreenResponse, 400: ErrorResponse }), validate("query", ScreenQuery), async (c) => {
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
