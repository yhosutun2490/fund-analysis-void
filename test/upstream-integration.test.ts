// 鉅亨畸形 payload 經真實 fetcher（只 mock fetch 與 DB 層）一路到 ingest 紀錄 / recovery 回應
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/repositories/ingest", () => ({
  upsertRecords: vi.fn().mockResolvedValue(0),
  updateInvestmentAreas: vi.fn().mockResolvedValue(0),
  recordRun: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/repositories/series", () => ({
  getSeries: vi.fn(),
  saveSeries: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/repositories/funds", () => ({
  getFund: vi.fn(),
  getLatestRisk: vi.fn().mockResolvedValue({ nav_date: "2026-10-09" }),
}));

import { request } from "./entry";
import { recordRun } from "../src/repositories/ingest";
import { getFund } from "../src/repositories/funds";
import { getSeries } from "../src/repositories/series";
import { runIngest } from "../src/services/ingest";

const env = { DB: {} as D1Database };
const respond = (json: unknown) =>
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => json }) as Response);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// normalize 會讀的欄位齊全的一列(值不重要,只看結構)
const STR = ["isinCode", "fundName", "fundGroup", "lippertW2_CHI", "fundCcyCode", "riskReturnRating", "llsRatings", "setup_date", "navDate", "dataTime", "perF_IMEJDate"];
const NUM = [
  "lipperid", "esG_Score", "fundtnA_TWD", "nav", "standarD_DEVIATION_1YMEJ", "sharpE_RATIO_1YMEJ", "sharpE_RATIO_3YMEJ",
  "sharpE_RATIO_5YMEJ", "sharpE_RATIO_10YMEJ", "perF_3MMEJ", "perF_6MMEJ", "perF_1YMEJ", "perF_3YMEJ", "perF_5YMEJ",
  ...[1, 2, 3, 4, 5].flatMap((i) => [`year_ROI${i}`, `year_MaxQuoteChange${i}`]),
];
const fullRow = { fundID: "A01", ...Object.fromEntries([...STR.map((k) => [k, "x"]), ...NUM.map((k) => [k, 1])]) };

describe("ingest:鉅亨破壞性變動 → ingest_runs 記 error", () => {
  it("fundDatas 列的已知欄位改型別 → status:error,note 帶點名路徑的 zod 訊息", async () => {
    respond({
      succ: true, code: "00000", message: "", dataTime: "2026-10-22",
      data: { dataCount: 1, fundDatas: [{ ...fullRow, nav: "10.5" }] },
    });
    await expect(runIngest(env)).rejects.toThrow(/格式不符/);
    const run = vi.mocked(recordRun).mock.calls[0][1];
    expect(run.status).toBe("error");
    expect(run.note).toMatch(/Search\/Detail 回應格式不符.*data\.fundDatas\[0\]\.nav/);
  });
});

describe("recovery:鉅亨格式不符不被當成一般 stale 降級", () => {
  const cache = {
    fund_id: "B1", basis: "total_return", series_start: "2018-01-01", series_end: "2020-01-01",
    points: JSON.stringify([["2018-01-01", 1], ["2020-01-01", 1.1]]), fetched_at: "2020-01-02T00:00:00Z",
  };

  beforeEach(() => {
    vi.mocked(getFund).mockResolvedValue({ fund_id: "B1", name: "f", setup_date: "2018-01-01" } as never);
    respond({ succ: true, code: "00000", data: [[1, 2]] }); // data 應為 JSON 字串
  });

  it("快取尚在 → 200 回快取,warning 指出上游格式變動", async () => {
    vi.mocked(getSeries).mockResolvedValue(cache as never);
    const res = await request("/api/funds/B1/recovery", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { series: { stale: boolean }; warning: string };
    expect(body.series.stale).toBe(true);
    expect(body.warning).toMatch(/上游格式變動.*FundDetail\/Price 回應格式不符/);
  });

  it("無快取 → 502,訊息標明格式問題", async () => {
    vi.mocked(getSeries).mockResolvedValue(null as never);
    const res = await request("/api/funds/B1/recovery", {}, env);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/格式變動.*FundDetail\/Price 回應格式不符/);
  });
});
