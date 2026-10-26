import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/anue/price", () => ({ fetchTotalReturnSeries: vi.fn() }));
vi.mock("../src/repositories/series", () => ({
  getSeries: vi.fn(),
  saveSeries: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/repositories/funds", () => ({
  getLatestRisk: vi.fn().mockResolvedValue({ nav_date: "2026-10-09" }), // 讓快取不新鮮
}));

import { fetchTotalReturnSeries } from "../src/anue/price";
import { getLatestRisk } from "../src/repositories/funds";
import { getSeries, saveSeries } from "../src/repositories/series";
import { loadSeries } from "../src/services/recovery";

type P = [string, number];
const env = { DB: {} as D1Database };
const fund = { fund_id: "B1", setup_date: "2018-01-01" };

const cachedPoints: P[] = [
  ["2018-01-01", 1],
  ["2019-01-01", 1.1],
  ["2020-01-01", 1.21],
];
const fullPoints: P[] = [
  ["2018-01-01", 1],
  ["2019-01-01", 1.1],
  ["2020-01-01", 1.21],
  ["2021-01-01", 1.331],
  ["2022-01-01", 1.4641],
];
// 增量自 series_end 重新起算(index 1)
const incrementPoints: P[] = [
  ["2020-01-01", 1],
  ["2021-01-01", 1.1],
  ["2022-01-01", 1.21],
];

function cachedRow(end = "2020-01-01") {
  return {
    fund_id: "B1", basis: "total_return",
    series_start: "2018-01-01", series_end: end,
    points: JSON.stringify(cachedPoints), fetched_at: "2020-01-02T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLatestRisk).mockResolvedValue({ nav_date: "2026-10-09" } as never);
});

describe("loadSeries — 增量更新", () => {
  it("過期:只補抓 [series_end, 今天],串接後與整條重抓一致", async () => {
    vi.mocked(getSeries).mockResolvedValue(cachedRow() as never);
    vi.mocked(fetchTotalReturnSeries).mockImplementation(async (_id, from) =>
      (from === "2020-01-01" ? incrementPoints : fullPoints) as P[],
    );

    const r = await loadSeries(env, fund);
    // 只發一段增量請求,from = series_end
    expect(fetchTotalReturnSeries).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTotalReturnSeries).mock.calls[0][1]).toBe("2020-01-01");
    expect(r.points).toEqual(fullPoints);
    expect(r.stale).toBe(false);
    expect(saveSeries).toHaveBeenCalledOnce();
  });

  it("增量首點日期不符 → 自動整條重抓", async () => {
    vi.mocked(getSeries).mockResolvedValue(cachedRow() as never);
    const mismatched: P[] = [["2020-06-01", 1], ["2021-01-01", 1.1]]; // 首點 ≠ series_end
    vi.mocked(fetchTotalReturnSeries).mockImplementation(async (_id, from) =>
      (from === "2020-01-01" ? mismatched : fullPoints) as P[],
    );

    const r = await loadSeries(env, fund);
    expect(fetchTotalReturnSeries).toHaveBeenCalledTimes(2); // 增量 + 整條
    expect(vi.mocked(fetchTotalReturnSeries).mock.calls[1][1]).toBe("2018-01-01"); // setup
    expect(r.points).toEqual(fullPoints);
  });

  it("refresh=true → 不做增量,直接整條重抓", async () => {
    vi.mocked(getSeries).mockResolvedValue(cachedRow() as never);
    vi.mocked(fetchTotalReturnSeries).mockResolvedValue(fullPoints as never);

    const r = await loadSeries(env, fund, { refresh: true });
    expect(fetchTotalReturnSeries).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchTotalReturnSeries).mock.calls[0][1]).toBe("2018-01-01"); // setup
    expect(r.points).toEqual(fullPoints);
  });

  it("增量抓取失敗 → 沿用快取並標 stale", async () => {
    vi.mocked(getSeries).mockResolvedValue(cachedRow() as never);
    vi.mocked(fetchTotalReturnSeries).mockRejectedValue(new Error("timeout"));

    const r = await loadSeries(env, fund);
    expect(r.stale).toBe(true);
    expect(r.warning).toBeTruthy();
    expect(r.points).toEqual(cachedPoints);
  });
});
