// GET /api/screen:快照初篩。範圍篩選決定回傳哪些基金;百分位永遠以完整 (category,currency) 組計算。
import { defineHandler } from "void";
import { DISCLAIMER } from "../../../src/disclaimer";
import { listFullGroups, listMatchedKeys, type ScreenFilters } from "../../../src/repositories/funds";
import { ScreenQuery, ScreenResponse } from "../../../src/schemas/screen";
import { ValidationErrorResponse } from "../../../src/schemas/shared";
import { screenGroups } from "../../../src/screen";
import { responds } from "../../../src/validation";

export const GET = responds(
  { 200: ScreenResponse, 400: ValidationErrorResponse },
  defineHandler.withValidator({ query: ScreenQuery })(async (c, { query }) => {
    const { minSharpePct, minDropPct, minWins, weakPct, weakWindows, limit, ...q } = query;
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
  }),
);
