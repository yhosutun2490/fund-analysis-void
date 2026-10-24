import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/repositories/funds", () => ({
  listFunds: vi.fn(),
  getFund: vi.fn(),
  getLatestRisk: vi.fn(),
  getRiskHistory: vi.fn(),
  listCategories: vi.fn(),
  listMatchedKeys: vi.fn(),
  listFullGroups: vi.fn(),
}));
vi.mock("../src/repositories/ingest", () => ({ listRuns: vi.fn() }));
vi.mock("../src/services/ingest", () => ({ runIngest: vi.fn() }));
vi.mock("../src/services/recovery", async (orig) => ({ ...(await orig()), loadSeries: vi.fn() }));

import { request } from "./entry";
import { DISCLAIMER } from "../src/disclaimer";
import {
  getFund, getLatestRisk, getRiskHistory, listCategories, listFullGroups, listFunds, listMatchedKeys,
} from "../src/repositories/funds";
import { listRuns } from "../src/repositories/ingest";
import { AdminIngestError, AdminIngestOk } from "../src/schemas/admin";
import { FundDetailResponse, FundHistoryResponse, FundListResponse, RecoveryResponse } from "../src/schemas/funds";
import { CategoriesResponse, RunsResponse } from "../src/schemas/meta";
import { RootResponse } from "../src/schemas/root";
import { ScreenResponse } from "../src/schemas/screen";
import { ErrorResponse } from "../src/schemas/shared";
import type { SeriesPoint } from "../src/recovery";
import type { ScreenRow } from "../src/screen";
import { runIngest } from "../src/services/ingest";
import { loadSeries } from "../src/services/recovery";

const env = { DB: {} as D1Database };
const get = (path: string) => request(path, {}, env);

// 與 D1 經 drizzle 取回的形狀一致(snake_case 別名;nullable 欄可為 null)
const fundRow = {
  fund_id: "A01", isin: "TW0000000001", lipper_id: 1, name: "f", fund_group: "股票型", category: "台灣股票",
  currency: "TWD", domicile: "onshore", investment_area: null, rr: "RR4", esg_score: null, setup_date: "2000-01-01",
  aum_twd: 1e9, updated_at: "2026-10-22T00:00:00Z",
};
const riskRow = {
  fund_id: "A01", as_of: "2026-09-30", std_1y: 12.3, sharpe_1y: 0.2, sharpe_3y: 0.3, sharpe_5y: null, sharpe_10y: null,
  ret_3m: 1, ret_6m: 2, ret_1y: 3, ret_3y: 4, ret_5y: null, roi_y1: 1, roi_y2: 2, roi_y3: 3, roi_y4: null, roi_y5: null,
  maxdrop_y1: -5, maxdrop_y2: -6, maxdrop_y3: null, maxdrop_y4: null, maxdrop_y5: null, lipper_total: "3",
  nav: 10.5, nav_date: "2026-10-21", ingested_at: "2026-10-22T00:00:00Z",
};
const listRow = {
  fund_id: "A01", name: "f", fund_group: "股票型", category: "台灣股票", currency: "TWD", domicile: "onshore", rr: "RR4",
  esg_score: null, aum_twd: 1e9, setup_date: "2000-01-01", as_of: "2026-09-30", std_1y: 12.3, sharpe_1y: 0.2,
  sharpe_3y: 0.3, sharpe_5y: null, sharpe_10y: null, ret_1y: 3, ret_3y: 4, ret_5y: null, maxdrop_y1: -5,
  lipper_total: "3", nav: 10.5, nav_date: "2026-10-21",
};

function screenRow(i: number, over: Partial<ScreenRow> = {}): ScreenRow {
  return {
    fund_id: `A0${i}`, name: `f${i}`, category: "台灣股票", currency: "TWD", rr: "RR4", as_of: "2026-09-30",
    sharpe_3y: i, ret_3m: i, ret_6m: i, ret_1y: i, roi_y1: i, roi_y2: i, roi_y3: i, roi_y4: i, roi_y5: i,
    maxdrop_y1: -10 + i, maxdrop_y2: -10 + i, maxdrop_y3: -10 + i, maxdrop_y4: -10 + i, maxdrop_y5: -10 + i,
    rec_series_end: null, rec_mdd: null, rec_mdd_recovered: null, rec_mdd_underwater_days: null,
    rec_still_underwater_ratio: null, rec_loss_prob_1y: null,
    ...over,
  };
}

function monthly(n: number): SeriesPoint[] {
  let v = 1;
  return Array.from({ length: n }, (_, i) => {
    v = i < n / 3 ? v * 1.02 : i < (2 * n) / 3 ? v * 0.97 : v * 1.03;
    return [new Date(Date.UTC(2015, i, 1)).toISOString().slice(0, 10), v];
  });
}
const loaded = (points: SeriesPoint[], extra = {}) => ({
  points, start: points[0]?.[0] ?? "2015-01-01", end: points.at(-1)?.[0] ?? "2026-10-22",
  fetched_at: "2026-10-22T00:00:00Z", stale: false, ...extra,
});

beforeEach(() => vi.clearAllMocks());

describe("成功回應符合各路由的 response schema", () => {
  it("GET /", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    RootResponse.parse(await res.json());
  });

  it("GET /api/funds(含 disclaimer)", async () => {
    vi.mocked(listFunds).mockResolvedValue([listRow] as never);
    const res = await get("/api/funds");
    expect(res.status).toBe(200);
    const body = FundListResponse.parse(await res.json());
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(body.funds).toHaveLength(1);
  });

  it("GET /api/funds/:id(有/無最新快照)", async () => {
    vi.mocked(getFund).mockResolvedValue(fundRow as never);
    vi.mocked(getLatestRisk).mockResolvedValueOnce(riskRow as never).mockResolvedValueOnce(null as never);
    for (let i = 0; i < 2; i++) {
      const res = await get("/api/funds/A01");
      expect(res.status).toBe(200);
      FundDetailResponse.parse(await res.json());
    }
  });

  it("GET /api/funds/:id/history", async () => {
    vi.mocked(getRiskHistory).mockResolvedValue([riskRow, { ...riskRow, as_of: "2026-08-31" }] as never);
    const res = await get("/api/funds/A01/history");
    expect(res.status).toBe(200);
    expect(FundHistoryResponse.parse(await res.json()).count).toBe(2);
  });

  it("GET /api/funds/:id/recovery(完整指標 / 序列過短 / stale + warning)", async () => {
    vi.mocked(getFund).mockResolvedValue(fundRow as never);
    vi.mocked(loadSeries)
      .mockResolvedValueOnce(loaded(monthly(140)))
      .mockResolvedValueOnce(loaded(monthly(10)))
      .mockResolvedValueOnce(loaded(monthly(140), { stale: true, warning: "上游失敗,沿用快取: timeout" }));
    const full = RecoveryResponse.parse(await (await get("/api/funds/A01/recovery")).json());
    expect(full.mdd).not.toBeNull();
    const short = RecoveryResponse.parse(await (await get("/api/funds/A01/recovery")).json());
    expect(short.reason).toBe("series_too_short");
    const stale = RecoveryResponse.parse(await (await get("/api/funds/A01/recovery")).json());
    expect(stale.warning).toContain("沿用快取");
  });

  it("GET /api/screen(含通過、資料不足與 recovery 摘要)", async () => {
    const rows = [1, 2, 3, 4, 5, 6].map((i) => screenRow(i));
    rows[5] = screenRow(6, { rec_series_end: "2026-10-21", rec_mdd: -0.3, rec_mdd_recovered: 1, rec_loss_prob_1y: 0.1 });
    rows.push(screenRow(7, { sharpe_3y: null }));
    vi.mocked(listMatchedKeys).mockResolvedValue(rows.map((r) => ({ fund_id: r.fund_id, category: r.category, currency: r.currency })));
    vi.mocked(listFullGroups).mockResolvedValue(rows);
    const res = await get("/api/screen?category=台灣股票&minSharpePct=0&minDropPct=0&minWins=0");
    expect(res.status).toBe(200);
    const body = ScreenResponse.parse(await res.json());
    expect(body.groups[0].passed.length).toBeGreaterThan(0);
    expect(body.groups[0].insufficient.length).toBe(1);
    expect(body.disclaimer).toBe(DISCLAIMER);
  });

  it("GET /api/meta/categories 與 /api/meta/runs", async () => {
    vi.mocked(listCategories).mockResolvedValue([{ category: "台灣股票", fund_group: "股票型", n: 120 }] as never);
    vi.mocked(listRuns).mockResolvedValue([
      { id: 2, started_at: "t0", finished_at: "t1", data_time: "2026-10-22", total_count: 4543, upserted: 4500, status: "ok", note: null },
      { id: 1, started_at: "t0", finished_at: "t1", data_time: null, total_count: 0, upserted: 0, status: "error", note: "boom" },
    ] as never);
    CategoriesResponse.parse(await (await get("/api/meta/categories")).json());
    RunsResponse.parse(await (await get("/api/meta/runs")).json());
  });

  it("POST /admin/ingest 成功與錯誤 payload", async () => {
    vi.mocked(runIngest)
      .mockResolvedValueOnce({ status: "ok", dataTime: "2026-10-22", dataCount: 1, fetched: 1, upserted: 1, note: undefined })
      .mockRejectedValueOnce(new Error("Anue HTTP 500"));
    const ok = await request("/admin/ingest", { method: "POST" }, env);
    expect(ok.status).toBe(200);
    AdminIngestOk.parse(await ok.json());
    const err = await request("/admin/ingest", { method: "POST" }, env);
    expect(err.status).toBe(500);
    expect(AdminIngestError.parse(await err.json()).message).toBe("Anue HTTP 500");
  });

  it("請求錯誤一律為 { error } 形狀", async () => {
    vi.mocked(getFund).mockResolvedValue(null as never);
    for (const path of ["/api/screen", "/api/funds?limit=abc", "/api/funds/NOPE"]) {
      ErrorResponse.parse(await (await get(path)).json());
    }
  });
});

describe("回應違反自身 schema", () => {
  const drifted = { ...fundRow, fundName: "renamed", name: undefined }; // 欄位改名:name 不見、多出 fundName

  afterEach(() => vi.unstubAllEnvs());

  it("非正式環境(dev/test):大聲失敗 → 500", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getFund).mockResolvedValue(drifted as never);
    vi.mocked(getLatestRisk).mockResolvedValue(null as never);
    const res = await get("/api/funds/A01");
    expect(res.status).toBe(500);
    log.mockRestore();
  });

  it("正式環境:fail-open,記錄違規但照常回傳原 payload", async () => {
    vi.stubEnv("PROD", true);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getFund).mockResolvedValue(drifted as never);
    vi.mocked(getLatestRisk).mockResolvedValue(null as never);
    const res = await get("/api/funds/A01");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { fund: { fundName: string } }).fund.fundName).toBe("renamed");
    expect(log.mock.calls.flat().join(" ")).toMatch(/response schema.*\/api\/funds\/:id/);
    log.mockRestore();
  });
});
