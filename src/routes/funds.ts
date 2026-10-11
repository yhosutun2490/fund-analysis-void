import { Hono } from "hono";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../env";
import { computeMdd, recentReturns } from "../recovery";
import { getFund, getLatestRisk, getRiskHistory, listFunds } from "../repositories/funds";
import { loadSeries, UpstreamUnavailable } from "../services/recovery";

export const funds = new Hono<{ Bindings: Env }>();

const MIN_POINTS = 60;

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

// 單檔回復分析：含息序列的最大回撤與近期報酬（episodes/events/lump_sum 由後續 ticket 疊加）
funds.get("/:id/recovery", async (c) => {
  const id = c.req.param("id");
  const fund = (await getFund(c.env.DB, id)) as { fund_id: string; name?: string; currency?: string; setup_date?: string | null } | null;
  if (!fund) return c.json({ error: "not found" }, 404);

  let data;
  try {
    data = await loadSeries(c.env, fund);
  } catch (e) {
    if (e instanceof UpstreamUnavailable) return c.json({ error: `上游無法取得且無快取: ${e.message}` }, 502);
    throw e;
  }

  const n = data.points.length;
  const tooShort = n < MIN_POINTS;
  return c.json({
    fund_id: id,
    name: fund.name ?? null,
    currency: fund.currency ?? null,
    basis: "total_return",
    source: "anue FundDetail/Price PerformanceHIS",
    series: { start: data.start, end: data.end, points: n, fetched_at: data.fetched_at, stale: data.stale },
    window: { from: data.points[0]?.[0] ?? data.start, to: data.points[n - 1]?.[0] ?? data.end },
    mdd: tooShort ? null : computeMdd(data.points),
    recent: tooShort ? null : recentReturns(data.points),
    ...(tooShort ? { reason: "series_too_short" } : {}),
    ...(data.warning ? { warning: data.warning } : {}),
    disclaimer: DISCLAIMER,
  });
});

// 單檔風險歷史（cron 累積出來的月序列）
funds.get("/:id/history", async (c) => {
  const id = c.req.param("id");
  const history = await getRiskHistory(c.env.DB, id);
  return c.json({ fund_id: id, count: history.length, history, disclaimer: DISCLAIMER });
});
