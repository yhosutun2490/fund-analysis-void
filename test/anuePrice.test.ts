import { afterEach, describe, expect, it, vi } from "vitest";
import { chunkRanges, fetchTotalReturnSeries, spliceSegments } from "../src/anuePrice";

describe("chunkRanges — ≤3 年切塊、交界日共用", () => {
  it("6 年 → 2 段", () => {
    expect(chunkRanges("2020-01-01", "2026-01-01")).toEqual([
      ["2020-01-01", "2023-01-01"],
      ["2023-01-01", "2026-01-01"],
    ]);
  });
  it("7 年 → 3 段(最後一段不足 3 年)", () => {
    const c = chunkRanges("2019-01-01", "2026-01-01");
    expect(c).toHaveLength(3);
    expect(c[0][0]).toBe("2019-01-01");
    expect(c[2][1]).toBe("2026-01-01");
  });
  it("短於 3 年 → 1 段", () => {
    expect(chunkRanges("2024-01-01", "2025-06-01")).toEqual([["2024-01-01", "2025-06-01"]]);
  });
});

const d = (s: string) => Date.parse(`${s}T00:00:00Z`);

describe("spliceSegments — 串接數值與交界去重", () => {
  it("兩段各 +10% → 末值 1.21,交界日只留一個", () => {
    const seg1: [number, number][] = [[d("2020-01-01"), 0], [d("2021-01-01"), 10]];
    const seg2: [number, number][] = [[d("2021-01-01"), 0], [d("2022-01-01"), 10]];
    const out = spliceSegments([seg1, seg2]);
    expect(out.map((p) => p[0])).toEqual(["2020-01-01", "2021-01-01", "2022-01-01"]);
    expect(out[0][1]).toBeCloseTo(1, 10);
    expect(out[1][1]).toBeCloseTo(1.1, 10);
    expect(out[2][1]).toBeCloseTo(1.21, 10);
  });

  it("前導空段跳過(基金尚未成立),以第一個非空段為起點", () => {
    const out = spliceSegments([[], [[d("2024-01-01"), 0], [d("2024-06-01"), 5]]]);
    expect(out.map((p) => p[0])).toEqual(["2024-01-01", "2024-06-01"]);
    expect(out[1][1]).toBeCloseTo(1.05, 10);
  });

  it("中段空塊 → 整條失敗不拼接", () => {
    const seg1: [number, number][] = [[d("2020-01-01"), 0]];
    const seg3: [number, number][] = [[d("2022-01-01"), 0]];
    expect(() => spliceSegments([seg1, [], seg3])).toThrow();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("fetchTotalReturnSeries — mock fetch", () => {
  it("每段一次請求、data 字串解析後串接", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      // 回該段 [[epoch, pct]];各段自 0 起漲 10%
      const s = d(body.strDate.replaceAll("/", "-"));
      const e = d(body.endDate.replaceAll("/", "-"));
      const data = JSON.stringify([[s, 0], [e, 10]]);
      return { ok: true, json: async () => ({ succ: true, code: "00000", data }) } as Response;
    });

    const series = await fetchTotalReturnSeries("B76003", "2020-01-01", "2026-01-01");
    expect(calls).toHaveLength(2); // 6 年 → 2 段
    expect(series[series.length - 1][1]).toBeCloseTo(1.21, 10); // 兩段各 +10%
  });

  it("data 為空字串 → 視為無資料(回空序列)", async () => {
    vi.stubGlobal("fetch", async () =>
      ({ ok: true, json: async () => ({ succ: true, code: "00000", data: "" }) }) as Response,
    );
    const series = await fetchTotalReturnSeries("X", "2024-01-01", "2025-01-01");
    expect(series).toEqual([]);
  });
});
