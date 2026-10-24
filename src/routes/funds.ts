import { Hono } from "hono";
import { AnueSchemaError } from "../anueSchema";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../bindings";
import { computeEpisodes, computeEvents, computeLumpSum, computeMdd, recentReturns, sliceWindow } from "../recovery";
import { getFund, getLatestRisk, getRiskHistory, listFunds } from "../repositories/funds";
import { loadSeries, UpstreamUnavailable } from "../services/recovery";
import {
  FundDetailResponse, FundHistoryResponse, FundIdParam, FundListQuery, FundListResponse, RecoveryQuery, RecoveryResponse,
} from "../schemas/funds";
import { ErrorResponse } from "../schemas/shared";
import { responds, validate } from "../validation";

export const funds = new Hono<{ Bindings: Env }>();

const MIN_POINTS = 60;

// 基金清單 + 篩選 + 排序（以最新快照）
funds.get("/", responds({ 200: FundListResponse, 400: ErrorResponse }), validate("query", FundListQuery), async (c) => {
  const { order, limit, offset, ...q } = c.req.valid("query");
  const results = await listFunds(c.env.DB, { ...q, order: order === "asc" ? "ASC" : "DESC", limit, offset });
  return c.json({ count: results.length, limit, offset, disclaimer: DISCLAIMER, funds: results });
});

// 單檔：基本資料 + 最新快照
funds.get("/:id", responds({ 200: FundDetailResponse, 400: ErrorResponse, 404: ErrorResponse }), validate("param", FundIdParam), async (c) => {
  const { id } = c.req.valid("param");
  const fund = await getFund(c.env.DB, id);
  if (!fund) return c.json({ error: "not found" }, 404);
  const latest = await getLatestRisk(c.env.DB, id);
  return c.json({ fund, latest_risk: latest, disclaimer: DISCLAIMER });
});

// 單檔回復分析：含息序列的最大回撤與近期報酬（episodes/events/lump_sum 由後續 ticket 疊加）
funds.get(
  "/:id/recovery",
  responds({ 200: RecoveryResponse, 400: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse }),
  validate("param", FundIdParam),
  validate("query", RecoveryQuery),
  async (c) => {
    const { id } = c.req.valid("param");
    const { from, to, minDepth, refresh } = c.req.valid("query");
    const fund = (await getFund(c.env.DB, id)) as { fund_id: string; name?: string; currency?: string; setup_date?: string | null } | null;
    if (!fund) return c.json({ error: "not found" }, 404);

    let data;
    try {
      data = await loadSeries(c.env, fund, { refresh });
    } catch (e) {
      if (e instanceof UpstreamUnavailable) return c.json({ error: `上游無法取得且無快取: ${e.message}` }, 502);
      if (e instanceof AnueSchemaError) return c.json({ error: `上游回應格式變動且無快取: ${e.message}` }, 502);
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
  },
);

// 單檔風險歷史（cron 累積出來的月序列）
funds.get("/:id/history", responds({ 200: FundHistoryResponse, 400: ErrorResponse }), validate("param", FundIdParam), async (c) => {
  const { id } = c.req.valid("param");
  const history = await getRiskHistory(c.env.DB, id);
  return c.json({ fund_id: id, count: history.length, history, disclaimer: DISCLAIMER });
});
