import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/anue", () => ({
  fetchAllFunds: vi.fn().mockResolvedValue({ rows: [], dataTime: "2026-10-11", dataCount: 0 }),
  normalize: vi.fn(),
  fetchInvestmentAreaMap: vi.fn(),
}));
vi.mock("../src/repositories/ingest", () => ({
  upsertRecords: vi.fn().mockResolvedValue(0),
  updateInvestmentAreas: vi.fn().mockResolvedValue(0),
  recordRun: vi.fn().mockResolvedValue(undefined),
}));

import { fetchInvestmentAreaMap } from "../src/anue";
import { recordRun, updateInvestmentAreas } from "../src/repositories/ingest";
import { runIngest } from "../src/services/ingest";

const env = { DB: {} as D1Database } as never;

beforeEach(() => vi.clearAllMocks());

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
