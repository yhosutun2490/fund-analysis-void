import { Hono } from "hono";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../env";
import { listFullGroups, listMatchedKeys, type ScreenFilters } from "../repositories/funds";
import { screenGroups, type Window } from "../screen";

export const screen = new Hono<{ Bindings: Env }>();

const WINDOWS: Window[] = ["3m", "6m", "1y"];

// 數值參數解析：未給用預設;非數值或超出範圍 → 丟字串錯誤訊息
function numParam(raw: string | undefined, def: number, lo: number, hi: number, name: string): number {
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} 須為 ${lo}–${hi} 的數值`);
  return n;
}

// weakWindows=逗號分隔,須為 3m/6m/1y 子集且非空
function parseWindows(raw: string | undefined): Window[] {
  if (raw === undefined) return ["6m", "1y"];
  const ws = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ws.length === 0 || !ws.every((w): w is Window => (WINDOWS as string[]).includes(w))) {
    throw new Error("weakWindows 僅允許 3m/6m/1y（逗號分隔）");
  }
  return ws;
}

// 多值參數：逗號分隔、去空白、濾空;無值 → undefined
function listParam(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const xs = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return xs.length ? xs : undefined;
}

// 快照初篩：範圍篩選決定回傳哪些基金;百分位永遠以完整 (category,currency) 組計算
screen.get("/", async (c) => {
  const q = c.req.query();

  const filters: ScreenFilters = {
    categories: listParam(q.category),
    areas: listParam(q.area),
    groups: listParam(q.group),
    domiciles: listParam(q.domicile),
    currencies: listParam(q.currency),
  };
  if (!filters.categories && !filters.areas && !filters.groups) {
    return c.json({ error: "category / area / group 至少擇一（決定篩選範圍）" }, 400);
  }

  let minSharpePct: number, minDropPct: number, minWins: number, weakPct: number, limit: number;
  let weakWindows: Window[];
  try {
    minSharpePct = numParam(q.minSharpePct, 50, 0, 100, "minSharpePct");
    minDropPct = numParam(q.minDropPct, 40, 0, 100, "minDropPct");
    minWins = numParam(q.minWins, 3, 0, 5, "minWins");
    weakPct = numParam(q.weakPct, 40, 0, 100, "weakPct");
    weakWindows = parseWindows(q.weakWindows);
    limit = numParam(q.limit, 100, 1, 500, "limit");
    if (q.maxRr !== undefined) filters.maxRr = numParam(q.maxRr, 5, 1, 5, "maxRr");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

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
