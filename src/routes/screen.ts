import { Hono } from "hono";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../env";
import { listScreenRows } from "../repositories/funds";
import { screenGroups } from "../screen";

export const screen = new Hono<{ Bindings: Env }>();

// 數值參數解析：未給用預設;非數值或超出範圍 → 丟字串錯誤訊息
function numParam(raw: string | undefined, def: number, lo: number, hi: number, name: string): number {
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${name} 須為 ${lo}–${hi} 的數值`);
  return n;
}

// 快照初篩：同組百分位 + 入選規則
screen.get("/", async (c) => {
  const q = c.req.query();
  if (!q.category) return c.json({ error: "category 為必填（決定可比較的同組）" }, 400);

  let minSharpePct: number, minDropPct: number, minWins: number, limit: number;
  try {
    minSharpePct = numParam(q.minSharpePct, 50, 0, 100, "minSharpePct");
    minDropPct = numParam(q.minDropPct, 40, 0, 100, "minDropPct");
    minWins = numParam(q.minWins, 3, 0, 5, "minWins");
    limit = numParam(q.limit, 100, 1, 500, "limit");
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }

  const rows = await listScreenRows(c.env.DB, q.category, q.currency);
  const groups = screenGroups(rows, { minSharpePct, minDropPct, minWins }).map((g) => ({
    ...g,
    passed: g.passed.slice(0, limit),
  }));

  return c.json({
    groups,
    params: { minSharpePct, minDropPct, minWins },
    basis: "anue_year_fields_unverified",
    disclaimer: DISCLAIMER,
  });
});
