import { describe, expect, it } from "vitest";
import { computeMdd, recentReturns, type SeriesPoint } from "../src/recovery";

describe("computeMdd — 已回復", () => {
  const points: SeriesPoint[] = [
    ["2020-01-01", 100],
    ["2020-02-01", 80],
    ["2020-03-01", 70],
    ["2020-04-01", 90],
    ["2020-05-01", 100],
    ["2020-06-01", 110],
  ];
  const dd = computeMdd(points);

  it("depth 為小數、峰谷日期正確", () => {
    expect(dd.depth).toBeCloseTo(-0.3, 10);
    expect(dd.peak).toBe("2020-01-01");
    expect(dd.trough).toBe("2020-03-01");
  });

  it("回復日為谷底後第一個 ≥ 前高", () => {
    expect(dd.recovered).toBe(true);
    expect(dd.recovery).toBe("2020-05-01");
    expect(dd.recovery_days).toBe(61); // 2020-03-01 → 2020-05-01 (31+30)
    expect(dd.underwater_days).toBe(121); // 2020-01-01 → 2020-05-01
  });
});

describe("computeMdd — 未回復", () => {
  const points: SeriesPoint[] = [
    ["2020-01-01", 100],
    ["2020-02-01", 50],
    ["2020-03-01", 60],
  ];
  const dd = computeMdd(points);

  it("未回復:recovery null、underwater 算到最後日、gap_to_peak 為小數", () => {
    expect(dd.depth).toBeCloseTo(-0.5, 10);
    expect(dd.recovered).toBe(false);
    expect(dd.recovery).toBeNull();
    expect(dd.recovery_days).toBeNull();
    expect(dd.underwater_days).toBe(60); // 2020-01-01 → 2020-03-01
    expect(dd.gap_to_peak).toBeCloseTo(-0.4, 10); // 60/100 - 1
  });
});

describe("computeMdd — 資料不足", () => {
  it("少於 2 點 → depth null", () => {
    expect(computeMdd([["2020-01-01", 100]]).depth).toBeNull();
    expect(computeMdd([]).depth).toBeNull();
  });
});

describe("recentReturns", () => {
  const points: SeriesPoint[] = [
    ["2025-10-09", 100],
    ["2026-04-09", 110],
    ["2026-07-09", 120],
    ["2026-10-09", 132],
  ];
  const r = recentReturns(points);

  it("3M/6M/1Y 以該日或之前最近一點、報酬為小數", () => {
    expect(r.ret_3m).toBeCloseTo(0.1, 10); // 132/120
    expect(r.ret_6m).toBeCloseTo(0.2, 10); // 132/110
    expect(r.ret_1y).toBeCloseTo(0.32, 10); // 132/100
  });

  it("窗口短於某期間 → 該期間 null", () => {
    const short: SeriesPoint[] = [
      ["2026-09-09", 100],
      ["2026-10-09", 105],
    ];
    const s = recentReturns(short);
    expect(s.ret_3m).toBeNull();
    expect(s.ret_1y).toBeNull();
  });
});
