import { Hono } from "hono";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../env";
import { computeEpisodes, computeEvents, computeLumpSum, computeMdd, recentReturns, sliceWindow } from "../recovery";
import { getFund, getLatestRisk, getRiskHistory, listFunds } from "../repositories/funds";
import { loadSeries, UpstreamUnavailable } from "../services/recovery";

export const funds = new Hono<{ Bindings: Env }>();

const MIN_POINTS = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  // 參數：from/to 分析窗口、minDepth 回撤事件門檻
  const q = c.req.query();
  const { from, to } = q;
  if (from !== undefined && !DATE_RE.test(from)) return c.json({ error: "from 須為 YYYY-MM-DD" }, 400);
  if (to !== undefined && !DATE_RE.test(to)) return c.json({ error: "to 須為 YYYY-MM-DD" }, 400);
  if (from && to && from > to) return c.json({ error: "from 不可晚於 to" }, 400);
  const minDepth = q.minDepth === undefined ? 10 : Number(q.minDepth);
  if (!Number.isFinite(minDepth) || minDepth <= 0 || minDepth >= 100) {
    return c.json({ error: "minDepth 須在 (0,100)" }, 400);
  }

  let data;
  try {
    data = await loadSeries(c.env, fund);
  } catch (e) {
    if (e instanceof UpstreamUnavailable) return c.json({ error: `上游無法取得且無快取: ${e.message}` }, 502);
    throw e;
  }

  // 窗口內重新起算（指標以窗口子序列計）
  const win = sliceWindow(data.points, from, to);
  const n = win.length;
  const tooShort = n < MIN_POINTS;
  return c.json({
    fund_id: id,
    name: fund.name ?? null,
    currency: fund.currency ?? null,
    basis: "total_return",
    source: "anue FundDetail/Price PerformanceHIS",
    series: { start: data.start, end: data.end, points: data.points.length, fetched_at: data.fetched_at, stale: data.stale },
    window: { from: win[0]?.[0] ?? from ?? data.start, to: win[n - 1]?.[0] ?? to ?? data.end },
    mdd: tooShort ? null : computeMdd(win),
    episodes: tooShort ? [] : computeEpisodes(win, minDepth),
    events: tooShort ? {} : computeEvents(win),
    lump_sum: tooShort ? null : computeLumpSum(win),
    recent: tooShort ? null : recentReturns(win),
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
