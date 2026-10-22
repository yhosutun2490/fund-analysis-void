import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/anue", () => ({
  fetchAllFunds: vi.fn(),
  normalize: vi.fn(),
  fetchInvestmentAreaMap: vi.fn(),
}));
vi.mock("../src/repositories/ingest", () => ({
  upsertRecords: vi.fn().mockResolvedValue(0),
  updateInvestmentAreas: vi.fn().mockResolvedValue(0),
  recordRun: vi.fn().mockResolvedValue(undefined),
}));

import { fetchAllFunds, fetchInvestmentAreaMap } from "../src/anue";
import { AnueSchemaError } from "../src/anueSchema";
import { recordRun, updateInvestmentAreas } from "../src/repositories/ingest";
import { runIngest } from "../src/services/ingest";

const env = { DB: {} as D1Database } as never;

const cleanFetch = { rows: [], dataTime: "2026-10-11", dataCount: 0, warnings: [] };
const cleanAreas = { areaOf: new Map<string, string>(), warnings: [], errors: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAllFunds).mockResolvedValue(cleanFetch);
});

describe("runIngest — 投資區域整合", () => {
  it("區域對照乾淨 → 更新區域欄", async () => {
    vi.mocked(fetchInvestmentAreaMap).mockResolvedValue({
      areaOf: new Map([["A01", "亞洲"]]),
      warnings: [],
      errors: [],
    });
    await runIngest(env);
    expect(updateInvestmentAreas).toHaveBeenCalledOnce();
    expect(vi.mocked(recordRun).mock.calls[0][1].status).toBe("ok");
  });

  it("有區域查詢失敗 → 不更新區域欄,note 記錄錯誤,ingest 仍成功", async () => {
    vi.mocked(fetchInvestmentAreaMap).mockResolvedValue({
      areaOf: new Map([["A01", "亞洲"]]),
      warnings: [],
      errors: ["歐洲: Anue code 00999"],
    });
    const r = await runIngest(env);
    expect(updateInvestmentAreas).not.toHaveBeenCalled();
    const run = vi.mocked(recordRun).mock.calls[0][1];
    expect(run.status).toBe("ok");
    expect(run.note).toContain("歐洲");
    expect(r.status).toBe("ok");
  });

  it("區域抓取整個拋出 → 不影響 ingest 成功", async () => {
    vi.mocked(fetchInvestmentAreaMap).mockRejectedValue(new Error("Anue HTTP 500"));
    const r = await runIngest(env);
    expect(updateInvestmentAreas).not.toHaveBeenCalled();
    expect(r.status).toBe("ok");
    expect(vi.mocked(recordRun).mock.calls[0][1].note).toContain("500");
  });
});

describe("runIngest — 鉅亨契約變動", () => {
  it("破壞性變動(格式不符) → 記一筆 status:error,note 帶 zod 訊息,並往上拋", async () => {
    const msg = "鉅亨 Search/Detail 回應格式不符: data.fundDatas[3].nav: Invalid input: expected number, received string";
    vi.mocked(fetchAllFunds).mockRejectedValue(new AnueSchemaError(msg));
    await expect(runIngest(env)).rejects.toThrow(msg);
    const run = vi.mocked(recordRun).mock.calls[0][1];
    expect(run.status).toBe("error");
    expect(run.note).toBe(msg);
  });

  it("加性變動(未知欄位) → ingest 成功,warning 記進 note(與投資區域 warning 並列)", async () => {
    vi.mocked(fetchAllFunds).mockResolvedValue({ ...cleanFetch, warnings: ["鉅亨 Search/Detail 出現未知欄位（加性變動）: data.fundDatas[].brandNew"] });
    vi.mocked(fetchInvestmentAreaMap).mockResolvedValue({ ...cleanAreas, warnings: ["X 同時屬於 亞洲 與 歐洲，取前者"] });
    const r = await runIngest(env);
    const run = vi.mocked(recordRun).mock.calls[0][1];
    expect(run.status).toBe("ok");
    expect(run.note).toContain("data.fundDatas[].brandNew");
    expect(run.note).toContain("投資區域警告");
    expect(r.note).toBe(run.note);
  });

  it("乾淨成功 → note 為空", async () => {
    vi.mocked(fetchInvestmentAreaMap).mockResolvedValue(cleanAreas);
    const r = await runIngest(env);
    expect(vi.mocked(recordRun).mock.calls[0][1].note).toBeUndefined();
    expect(r.note).toBeUndefined();
  });
});
