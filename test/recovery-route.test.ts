import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/anuePrice", () => ({ fetchTotalReturnSeries: vi.fn() }));
vi.mock("../src/repositories/series", () => ({
  getSeries: vi.fn(),
  saveSeries: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/repositories/funds", () => ({
  getFund: vi.fn(),
  getLatestRisk: vi.fn().mockResolvedValue(null),
}));

import { app } from "../src/app";
import { fetchTotalReturnSeries } from "../src/anuePrice";
import { getFund, getLatestRisk } from "../src/repositories/funds";
import { getSeries, saveSeries } from "../src/repositories/series";

const env = { DB: {} as D1Database };
const req = (path: string) => app.request(path, {}, env);

// 由月序列產生 n 點,中途回撤後回復
function series(n: number): [string, number][] {
  const out: [string, number][] = [];
  let v = 100;
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2018, i, 1)).toISOString().slice(0, 10);
    // 前半上漲、中間跌、後段回升
    v = i < n / 3 ? v * 1.02 : i < (2 * n) / 3 ? v * 0.97 : v * 1.03;
    out.push([d, v]);
  }
  return out;
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/funds/:id/recovery — 錯誤處理", () => {
  it("未知基金 → 404", async () => {
    vi.mocked(getFund).mockResolvedValue(null);
    const res = await req("/api/funds/NOPE/recovery");
    expect(res.status).toBe(404);
  });

  it("無快取且上游失敗 → 502", async () => {
    vi.mocked(getFund).mockResolvedValue({ fund_id: "B1", name: "f", currency: "USD", setup_date: "2015-01-01" } as never);
    vi.mocked(getSeries).mockResolvedValue(null as never);
    vi.mocked(fetchTotalReturnSeries).mockRejectedValue(new Error("Anue HTTP 500"));
    const res = await req("/api/funds/B1/recovery");
    expect(res.status).toBe(502);
  });

  it("有效點 < 60 → 200,指標 null + series_too_short", async () => {
    vi.mocked(getFund).mockResolvedValue({ fund_id: "B2", name: "f", currency: "USD", setup_date: "2024-01-01" } as never);
    vi.mocked(getSeries).mockResolvedValue(null as never);
    vi.mocked(fetchTotalReturnSeries).mockResolvedValue(series(10));
    const res = await req("/api/funds/B2/recovery");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.mdd).toBeNull();
    expect(body.recent).toBeNull();
    expect(body.reason).toBe("series_too_short");
  });

  it("抓取成功(≥60 點) → 200,mdd/recent/episodes/events 有值,寫入快取", async () => {
    vi.mocked(getFund).mockResolvedValue({ fund_id: "B3", name: "f", currency: "USD", setup_date: "2015-01-01" } as never);
    vi.mocked(getSeries).mockResolvedValue(null as never);
    vi.mocked(fetchTotalReturnSeries).mockResolvedValue(series(70));
    const res = await req("/api/funds/B3/recovery");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(typeof body.mdd.depth).toBe("number");
    expect(body.mdd.depth).toBeLessThan(0);
    expect(body.series.stale).toBe(false);
    expect(Array.isArray(body.episodes)).toBe(true);
    expect(body.events).toHaveProperty("covid_2020");
    expect(body.lump_sum).toHaveProperty("still_underwater_ratio");
    expect(body.lump_sum.holding).toHaveProperty("1y");
    expect(body.window).toHaveProperty("from");
    expect(saveSeries).toHaveBeenCalledOnce();
    // 寫入時帶全期間摘要(ticket 10)
    const summary = vi.mocked(saveSeries).mock.calls[0][2] as any;
    expect(typeof summary.mdd).toBe("number");
  });

  it("自訂 from/to 不改寫全期間摘要(摘要恆為整條序列)", async () => {
    vi.mocked(getFund).mockResolvedValue({ fund_id: "B7", name: "f", currency: "USD", setup_date: "2015-01-01" } as never);
    vi.mocked(getSeries).mockResolvedValue(null as never);
    vi.mocked(fetchTotalReturnSeries).mockResolvedValue(series(70));
    await req("/api/funds/B7/recovery?from=2019-01-01&to=2020-01-01");
    const summary = vi.mocked(saveSeries).mock.calls[0][2] as any;
    // 摘要由整條 70 點序列算出(非窗口),mdd 存在
    expect(typeof summary.mdd).toBe("number");
    expect(summary.mdd_recovered).not.toBeUndefined();
  });

  it("minDepth 不在 (0,100) → 400", async () => {
    vi.mocked(getFund).mockResolvedValue({ fund_id: "B5", name: "f", setup_date: "2015-01-01" } as never);
    expect((await req("/api/funds/B5/recovery?minDepth=0")).status).toBe(400);
    expect((await req("/api/funds/B5/recovery?minDepth=150")).status).toBe(400);
  });

  it("from > to 或日期格式錯 → 400", async () => {
    vi.mocked(getFund).mockResolvedValue({ fund_id: "B6", name: "f", setup_date: "2015-01-01" } as never);
    expect((await req("/api/funds/B6/recovery?from=2026-01-01&to=2020-01-01")).status).toBe(400);
    expect((await req("/api/funds/B6/recovery?from=2026%2F01%2F01")).status).toBe(400);
  });

  it("上游失敗但有快取 → 200,stale:true + warning", async () => {
    vi.mocked(getFund).mockResolvedValue({ fund_id: "B4", name: "f", currency: "USD", setup_date: "2015-01-01" } as never);
    vi.mocked(getLatestRisk).mockResolvedValue({ nav_date: "2026-10-09" } as never);
    vi.mocked(getSeries).mockResolvedValue({
      fund_id: "B4", basis: "total_return",
      series_start: "2018-01-01", series_end: "2020-01-01", // 落後 nav_date → 不新鮮
      points: JSON.stringify(series(70)), fetched_at: "2020-01-02T00:00:00Z",
    } as never);
    vi.mocked(fetchTotalReturnSeries).mockRejectedValue(new Error("timeout"));
    const res = await req("/api/funds/B4/recovery");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.series.stale).toBe(true);
    expect(body.warning).toBeTruthy();
  });
});
