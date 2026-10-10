import { Hono } from "hono";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../env";
import { getFund, getLatestRisk, getRiskHistory, listFunds } from "../repositories/funds";

export const funds = new Hono<{ Bindings: Env }>();

// 基金清單 + 篩選 + 排序（以最新快照）
funds.get("/", async (c) => {
  const q = c.req.query();
  const limit = Math.min(Number(q.limit ?? "50"), 500);
  const offset = Number(q.offset ?? "0");
  const results = await listFunds(c.env.DB, {
    group: q.group,
    category: q.category,
    currency: q.currency,
    rr: q.rr,
    domicile: q.domicile,
    minSharpe3y: q.minSharpe3y ? Number(q.minSharpe3y) : undefined,
    maxStd1y: q.maxStd1y ? Number(q.maxStd1y) : undefined,
    sort: q.sort,
    order: (q.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC",
    limit,
    offset,
  });
  return c.json({ count: results.length, limit, offset, disclaimer: DISCLAIMER, funds: results });
});

// 單檔：基本資料 + 最新快照
funds.get("/:id", async (c) => {
  const id = c.req.param("id");
  const fund = await getFund(c.env.DB, id);
  if (!fund) return c.json({ error: "not found" }, 404);
  const latest = await getLatestRisk(c.env.DB, id);
  return c.json({ fund, latest_risk: latest, disclaimer: DISCLAIMER });
});

// 單檔風險歷史（cron 累積出來的月序列）
funds.get("/:id/history", async (c) => {
  const id = c.req.param("id");
  const history = await getRiskHistory(c.env.DB, id);
  return c.json({ fund_id: id, count: history.length, history, disclaimer: DISCLAIMER });
});
