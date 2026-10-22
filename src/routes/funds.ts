import { Hono } from "hono";
import { z } from "zod";
import { AnueSchemaError } from "../anueSchema";
import { DISCLAIMER } from "../disclaimer";
import type { Env } from "../bindings";
import { computeEpisodes, computeEvents, computeLumpSum, computeMdd, recentReturns, sliceWindow } from "../recovery";
import { getFund, getLatestRisk, getRiskHistory, listFunds } from "../repositories/funds";
import { loadSeries, UpstreamUnavailable } from "../services/recovery";
import {
  ErrorResponse, FundDetailResponse, FundHistoryResponse, FundListResponse, RecoveryResponse,
} from "../responses";
import { blankAsMissing, finiteNum, isoDate, nonNegInt, responds, validate } from "../validation";

export const funds = new Hono<{ Bindings: Env }>();

const MIN_POINTS = 60;

/** /api/funds 的輸入契約。limit 超過 500 夾到 500;空值參數視同未給;未知 sort 由 repository 回退 sharpe_3y。 */
const FundListQuery = z.object({
  group: z.string().optional(),
  category: z.string().optional(),
  currency: z.string().optional(),
  rr: z.string().optional(),
  domicile: z.string().optional(),
  minSharpe3y: blankAsMissing(finiteNum("minSharpe3y").optional()),
  maxStd1y: blankAsMissing(finiteNum("maxStd1y").optional()),
  sort: z.string().optional(),
  order: blankAsMissing(
    z
      .string()
      .toLowerCase()
      .pipe(z.enum(["asc", "desc"], { error: "order 僅允許 asc/desc" }))
      .default("desc"),
  ),
  limit: nonNegInt("limit")
    .default(50)
    .transform((n) => Math.min(n, 500)),
  offset: nonNegInt("offset").default(0),
});

const FundIdParam = z.object({ id: z.string().min(1) });

/** /api/funds/:id/recovery 的輸入契約。 */
const minDepthError = "minDepth 須在 (0,100)";
const RecoveryQuery = z
  .object({
    from: isoDate("from").optional(),
    to: isoDate("to").optional(),
    minDepth: z.coerce
      .number({ error: minDepthError })
      .gt(0, { error: minDepthError })
      .lt(100, { error: minDepthError })
      .default(10),
    refresh: z
      .string()
      .optional()
      .transform((v) => v === "true"),
  })
  .refine((q) => !(q.from && q.to && q.from > q.to), { error: "from 不可晚於 to" });

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
