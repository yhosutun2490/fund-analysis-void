import { describe, expect, it } from "vitest";
import {
  computeEpisodes,
  computeEvents,
  computeLumpSum,
  computeMdd,
  recentReturns,
  type SeriesPoint,
  sliceWindow,
} from "../src/recovery";

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

describe("sliceWindow", () => {
  const pts: SeriesPoint[] = [
    ["2020-01-01", 1],
    ["2021-01-01", 2],
    ["2022-01-01", 3],
    ["2023-01-01", 4],
  ];
  it("取 [from,to] 範圍(含端點)", () => {
    expect(sliceWindow(pts, "2021-01-01", "2022-01-01").map((p) => p[0])).toEqual([
      "2021-01-01",
      "2022-01-01",
    ]);
  });
  it("未給則全序列", () => {
    expect(sliceWindow(pts)).toHaveLength(4);
  });
});

describe("computeEpisodes — 水下區段切分與 minDepth", () => {
  const pts: SeriesPoint[] = [
    ["2020-01-01", 100],
    ["2020-02-01", 80], // -20% 區段
    ["2020-03-01", 100], // 回到前高
    ["2020-04-01", 120], // 新高
    ["2020-05-01", 90], // -25% 區段(未回復,開放)
  ];

  it("依深度排序、最深在前;開放區段 recovered=false", () => {
    const eps = computeEpisodes(pts, 10);
    expect(eps).toHaveLength(2);
    expect(eps[0].depth).toBeCloseTo(-0.25, 10);
    expect(eps[0].recovered).toBe(false);
    expect(eps[0].recovery).toBeNull();
    expect(eps[1].depth).toBeCloseTo(-0.2, 10);
    expect(eps[1].recovered).toBe(true);
    expect(eps[1].recovery).toBe("2020-03-01");
  });

  it("minDepth 門檻濾掉淺的區段", () => {
    const eps = computeEpisodes(pts, 22);
    expect(eps).toHaveLength(1);
    expect(eps[0].depth).toBeCloseTo(-0.25, 10);
  });
});

describe("computeEvents — 預設事件覆蓋判斷", () => {
  it("窗口完整覆蓋 → peak/trough 限區間內、recovery 往後找", () => {
    const pts: SeriesPoint[] = [
      ["2019-12-01", 100],
      ["2020-02-01", 100],
      ["2020-03-15", 70],
      ["2020-06-01", 90],
      ["2026-01-01", 110],
    ];
    const ev = computeEvents(pts);
    const covid = ev.covid_2020 as any;
    expect(covid.depth).toBeCloseTo(-0.3, 10);
    expect(covid.trough).toBe("2020-03-15");
    expect(covid.recovered).toBe(true);
    expect(covid.recovery).toBe("2026-01-01");
  });

  it("窗口未覆蓋事件區間 → null + reason not_covered", () => {
    const pts: SeriesPoint[] = [
      ["2021-01-01", 100],
      ["2026-01-01", 110],
    ];
    const ev = computeEvents(pts);
    expect((ev.covid_2020 as any).reason).toBe("not_covered");
  });
});

describe("computeLumpSum — 單筆進場", () => {
  it("全程上漲:仍虧損比例 0、最長水下 0", () => {
    const pts: SeriesPoint[] = [
      ["2020-01-01", 100],
      ["2020-06-01", 110],
      ["2021-01-01", 120],
    ];
    const ls = computeLumpSum(pts);
    expect(ls.still_underwater_ratio).toBe(0);
    expect(ls.longest_underwater_days).toBe(0);
    expect(ls.longest_underwater_open).toBe(false);
  });

  it("未回本開放區間:最長水下標 open、附進場日", () => {
    const pts: SeriesPoint[] = [
      ["2020-01-01", 100],
      ["2020-06-01", 120],
      ["2021-01-01", 80], // 自 120 進場後未回本
    ];
    const ls = computeLumpSum(pts);
    expect(ls.still_underwater_ratio).toBeCloseTo(2 / 3, 10);
    expect(ls.longest_underwater_open).toBe(true);
    expect(ls.longest_underwater_entry).toBe("2020-06-01");
  });

  it("持有:1y loss_prob/worst/median;3y 窗口不足 → reason", () => {
    const pts: SeriesPoint[] = [
      ["2020-01-01", 100],
      ["2021-01-01", 90],
      ["2022-01-01", 130],
    ];
    const ls = computeLumpSum(pts);
    const h1 = ls.holding["1y"] as any;
    expect(h1.loss_prob).toBeCloseTo(0.5, 10);
    expect(h1.worst).toBeCloseTo(-0.1, 10);
    expect(h1.median).toBeCloseTo(0.17, 2);
    expect((ls.holding["3y"] as any).reason).toBe("window_shorter_than_horizon");
  });
});
