import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/anue/price", () => ({ fetchTotalReturnSeries: vi.fn() }));
vi.mock("../src/repositories/series", () => ({
  getSeries: vi.fn(),
  saveSeries: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/repositories/funds", () => ({
  getFund: vi.fn(),
  getLatestRisk: vi.fn().mockResolvedValue(null),
}));

import { request } from "./entry";
import { AnueSchemaError } from "../src/anue/schema";
import { fetchTotalReturnSeries } from "../src/anue/price";
import { getFund, getLatestRisk } from "../src/repositories/funds";
import { getSeries, saveSeries } from "../src/repositories/series";
import { ValidationErrorResponse } from "../src/schemas/shared";

const env = { DB: {} as D1Database };
const req = (path: string) => request(path, {}, env);

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
    vi.mocked(getFund).mockResolvedValue(null as never);
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

describe("GET /api/funds/:id/recovery — 鉅亨格式不符與上游不可用分開", () => {
  const schemaErr = () => new AnueSchemaError("鉅亨 FundDetail/Price 回應格式不符: data: Invalid input: expected string, received array");
  const staleCache = (id: string) => ({
    fund_id: id, basis: "total_return",
    series_start: "2018-01-01", series_end: "2020-01-01",
    points: JSON.stringify(series(70)), fetched_at: "2020-01-02T00:00:00Z",
  });

  it("無快取 + 格式不符 → 502,訊息標明是格式問題(非一般不可用),並記錄", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getFund).mockResolvedValue({ fund_id: "C1", name: "f", setup_date: "2015-01-01" } as never);
    vi.mocked(getSeries).mockResolvedValue(null as never);
    vi.mocked(fetchTotalReturnSeries).mockRejectedValue(schemaErr());
    const res = await req("/api/funds/C1/recovery");
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("格式");
    expect(body.error).toContain("expected string");
    expect(body.error).not.toContain("上游無法取得");
    expect(log.mock.calls.flat().join(" ")).toContain("格式不符");
    log.mockRestore();
  });

  it("有快取 + 整條重抓格式不符 → 200 回快取,warning 明確指出上游格式變動,並記錄", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getFund).mockResolvedValue({ fund_id: "C2", name: "f", setup_date: "2015-01-01" } as never);
    vi.mocked(getSeries).mockResolvedValue(staleCache("C2") as never);
    vi.mocked(fetchTotalReturnSeries).mockRejectedValue(schemaErr());
    const res = await req("/api/funds/C2/recovery?refresh=true");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.series.stale).toBe(true);
    expect(body.warning).toContain("格式變動");
    expect(body.warning).not.toContain("上游失敗");
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("有快取 + 增量抓取格式不符 → warning 同樣明確指出格式變動(不併入一般增量失敗)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getFund).mockResolvedValue({ fund_id: "C3", name: "f", setup_date: "2015-01-01" } as never);
    vi.mocked(getLatestRisk).mockResolvedValue({ nav_date: "2026-10-09" } as never);
    vi.mocked(getSeries).mockResolvedValue(staleCache("C3") as never);
    vi.mocked(fetchTotalReturnSeries).mockRejectedValue(schemaErr());
    const res = await req("/api/funds/C3/recovery");
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.series.stale).toBe(true);
    expect(body.warning).toContain("格式變動");
    expect(body.warning).not.toContain("增量更新失敗");
    log.mockRestore();
  });
});

describe("GET /api/funds/:id/recovery — 請求驗證", () => {
  const fund = { fund_id: "V1", name: "f", currency: "USD", setup_date: "2015-01-01" };
  const freshCache = {
    fund_id: "V1", basis: "total_return", series_start: "2018-01-01", series_end: "2026-10-09",
    points: JSON.stringify(series(70)), fetched_at: "2026-10-10T00:00:00Z",
  };

  beforeEach(() => {
    vi.mocked(getFund).mockResolvedValue(fund as never);
    vi.mocked(getLatestRisk).mockResolvedValue({ nav_date: "2026-10-09" } as never);
    vi.mocked(getSeries).mockResolvedValue(freshCache as never);
  });

  // Void 會列出所有失敗的 issue → 回傳全部訊息,由案例斷言其中包含預期的那則
  async function error400(path: string) {
    const res = await req(path);
    expect(res.status).toBe(400);
    const body = ValidationErrorResponse.parse(await res.json());
    return body.issues.flatMap((slot) => slot.issues.map((i) => i.message));
  }

  it.each([
    ["minDepth=0", "minDepth 須在 (0,100)"],
    ["minDepth=100", "minDepth 須在 (0,100)"],
    ["minDepth=abc", "minDepth 須在 (0,100)"],
    ["from=2026-1-1", "from 須為 YYYY-MM-DD"],
    ["to=20260101", "to 須為 YYYY-MM-DD"],
    ["from=2026-01-02&to=2026-01-01", "from 不可晚於 to"],
  ])("%s → 400「%s」", async (qs, msg) => {
    expect(await error400(`/api/funds/V1/recovery?${qs}`)).toContain(msg);
  });

  it.each(["minDepth=0.5", "minDepth=99.5", "from=2020-01-01&to=2020-01-01"])("邊界值 %s 接受", async (qs) => {
    expect((await req(`/api/funds/V1/recovery?${qs}`)).status).toBe(200);
  });

  it("refresh=true → 不用新鮮快取,整條重抓;未給則沿用快取", async () => {
    vi.mocked(fetchTotalReturnSeries).mockResolvedValue(series(70));
    await req("/api/funds/V1/recovery");
    expect(fetchTotalReturnSeries).not.toHaveBeenCalled();
    await req("/api/funds/V1/recovery?refresh=true");
    expect(fetchTotalReturnSeries).toHaveBeenCalledOnce();
  });
});
