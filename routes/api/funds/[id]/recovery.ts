// GET /api/funds/:id/recovery:單檔回復分析（含息序列的最大回撤、回撤事件、單筆投入與近期報酬）。
import { defineHandler } from "void";
import { AnueSchemaError } from "../../../../src/anue/schema";
import { computeEpisodes, computeEvents, computeLumpSum, computeMdd, recentReturns, sliceWindow } from "../../../../src/domain/recovery";
import { getFund } from "../../../../src/repositories/funds";
import { FundIdParam, RecoveryQuery, RecoveryResponse } from "../../../../src/schemas/funds";
import { DISCLAIMER, ErrorResponse, ValidationErrorResponse } from "../../../../src/schemas/shared";
import { loadSeries, UpstreamUnavailable } from "../../../../src/services/recovery";
import { responds } from "../../../../src/lib/validation";

/** 窗口內有效點少於此數 → 指標回 null 並標 series_too_short。 */
const MIN_POINTS = 60;

export const GET = responds(
  { 200: RecoveryResponse, 400: ValidationErrorResponse, 404: ErrorResponse, 502: ErrorResponse },
  defineHandler.withValidator({ params: FundIdParam, query: RecoveryQuery })(async (c, { params, query }) => {
    const { id } = params;
    const { from, to, minDepth, refresh } = query;
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
  }),
);
