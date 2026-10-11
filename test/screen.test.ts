import { describe, expect, it } from "vitest";
import { median, percentRank, type ScreenRow, screenGroup } from "../src/screen";

// 建一列 ScreenRow,未給的欄位為 null
function row(partial: Partial<ScreenRow>): ScreenRow {
  return {
    fund_id: "F",
    name: "fund",
    category: "台灣股票",
    currency: "TWD",
    rr: "RR4",
    as_of: "2026-08-31",
    sharpe_3y: null,
    roi_y1: null,
    roi_y2: null,
    roi_y3: null,
    roi_y4: null,
    roi_y5: null,
    maxdrop_y1: null,
    maxdrop_y2: null,
    maxdrop_y3: null,
    maxdrop_y4: null,
    maxdrop_y5: null,
    ret_3m: null,
    ret_6m: null,
    ret_1y: null,
    ...partial,
  };
}

// 一檔資料完整(5 年 roi/maxdrop + sharpe)的列
function complete(fund_id: string, o: Partial<ScreenRow>): ScreenRow {
  return row({
    fund_id,
    sharpe_3y: 1,
    roi_y1: 10,
    roi_y2: 10,
    roi_y3: 10,
    roi_y4: 10,
    roi_y5: 10,
    maxdrop_y1: -10,
    maxdrop_y2: -10,
    maxdrop_y3: -10,
    maxdrop_y4: -10,
    maxdrop_y5: -10,
    ...o,
  });
}

describe("percentRank — 3.2 公式", () => {
  it("最高值 → 100、最低值 → 0、中間 → 50", () => {
    const v = [1, 2, 3, 4, 5];
    expect(percentRank(5, v)).toBe(100);
    expect(percentRank(1, v)).toBe(0);
    expect(percentRank(3, v)).toBe(50);
  });

  it("同值取中位(0.5×(同值數−1))", () => {
    expect(percentRank(2, [1, 2, 2, 2, 5])).toBe(50);
  });

  it("有效樣本 < 2 → null", () => {
    expect(percentRank(1, [1])).toBeNull();
  });
});

describe("median", () => {
  it("奇數取中間、偶數取兩中位平均", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it("空陣列 → null", () => {
    expect(median([])).toBeNull();
  });
});

const PARAMS = { minSharpePct: 50, minDropPct: 40, minWins: 3 };

describe("screenGroup — 3.2 / 3.4 規則", () => {
  it("組內樣本 < 5 → 整組 insufficient:peer_group_too_small", () => {
    const rows = [complete("A", {}), complete("B", {}), complete("C", {}), complete("D", {})];
    const g = screenGroup(rows, PARAMS);
    expect(g.peer_count).toBe(4);
    expect(g.passed).toHaveLength(0);
    expect(g.insufficient.map((x) => x.reason)).toEqual([
      "peer_group_too_small",
      "peer_group_too_small",
      "peer_group_too_small",
      "peer_group_too_small",
    ]);
  });

  it("缺 sharpe_3y → insufficient:missing_sharpe_3y", () => {
    const rows = [
      complete("A", {}),
      complete("B", {}),
      complete("C", {}),
      complete("D", {}),
      complete("E", { sharpe_3y: null }),
    ];
    const g = screenGroup(rows, PARAMS);
    const e = g.insufficient.find((x) => x.fund_id === "E");
    expect(e?.reason).toBe("missing_sharpe_3y");
  });

  it("roi/maxdrop 年度 < 3 → insufficient:fewer_than_3_years", () => {
    const short = complete("E", {
      roi_y3: null,
      roi_y4: null,
      roi_y5: null, // 只剩 2 年
    });
    const rows = [complete("A", {}), complete("B", {}), complete("C", {}), complete("D", {}), short];
    const g = screenGroup(rows, PARAMS);
    expect(g.insufficient.find((x) => x.fund_id === "E")?.reason).toBe("fewer_than_3_years");
  });

  it("入選需三門檻皆過,否則計入 rejected_count", () => {
    // 5 檔夏普遞增,最高者 sharpe_pct=100;其餘報酬/跌幅相同
    const rows = [
      complete("A", { sharpe_3y: 1 }),
      complete("B", { sharpe_3y: 2 }),
      complete("C", { sharpe_3y: 3 }),
      complete("D", { sharpe_3y: 4 }),
      complete("E", { sharpe_3y: 5 }),
    ];
    const g = screenGroup(rows, PARAMS);
    // worst_drop 全相同 → worst_drop_pct=50 ≥ 40 過;wins=0(都等於中位)→ minWins 3 不過
    // 故全被 reject(wins 不足)
    expect(g.passed).toHaveLength(0);
    expect(g.rejected_count).toBe(5);
  });

  it("勝率:報酬高於同組當年度中位數的年數", () => {
    // D 每年報酬都最高 → wins=5;其餘持平
    const rows = [
      complete("A", {}),
      complete("B", {}),
      complete("C", {}),
      complete("D", { roi_y1: 99, roi_y2: 99, roi_y3: 99, roi_y4: 99, roi_y5: 99, sharpe_3y: 9, maxdrop_y1: -1, maxdrop_y2: -1, maxdrop_y3: -1, maxdrop_y4: -1, maxdrop_y5: -1 }),
      complete("E", {}),
    ];
    const g = screenGroup(rows, PARAMS);
    const d = g.passed.find((x) => x.fund_id === "D");
    expect(d).toBeTruthy();
    expect(d?.wins).toBe(5);
    expect(d?.win_years).toBe(5);
    expect(d?.sharpe_pct).toBe(100);
  });

  // 長期好(夏普最高、勝率高、跌幅最佳)故入選;近期報酬可調
  function weakScenario(t: Partial<ScreenRow>): ScreenRow[] {
    const T = complete("T", {
      sharpe_3y: 10,
      roi_y1: 99, roi_y2: 99, roi_y3: 99, roi_y4: 99, roi_y5: 99,
      maxdrop_y1: -1, maxdrop_y2: -1, maxdrop_y3: -1, maxdrop_y4: -1, maxdrop_y5: -1,
      ...t,
    });
    const others = ["O1", "O2", "O3", "O4"].map((id, i) =>
      complete(id, { sharpe_3y: i + 1, ret_3m: 1, ret_6m: 100, ret_1y: 100 }),
    );
    return [T, ...others];
  }
  const t = (g: ReturnType<typeof screenGroup>) => g.passed.find((x) => x.fund_id === "T");

  it("ladder:近期報酬組內百分位", () => {
    const g = screenGroup(weakScenario({ ret_3m: 100, ret_6m: 1, ret_1y: 1 }), PARAMS);
    expect(t(g)?.ladder.ret_3m_pct).toBe(100);
    expect(t(g)?.ladder.ret_6m_pct).toBe(0);
    expect(t(g)?.ladder.ret_1y_pct).toBe(0);
  });

  it("weak_flag=true:長期好且預設窗口(6M、1Y)皆落後", () => {
    const g = screenGroup(weakScenario({ ret_3m: 100, ret_6m: 1, ret_1y: 1 }), PARAMS);
    expect(t(g)?.weak_flag).toBe(true);
    expect(t(g)?.reasons.some((r) => r.includes("6M") && r.includes("1Y"))).toBe(true);
  });

  it("weak_flag=false:近期強(6M、1Y 皆領先)", () => {
    const g = screenGroup(weakScenario({ ret_3m: 1, ret_6m: 100, ret_1y: 100 }), PARAMS);
    expect(t(g)?.weak_flag).toBe(false);
  });

  it("3M 預設不單獨觸發:只有 3M 落後、6M/1Y 領先 → false", () => {
    const g = screenGroup(weakScenario({ ret_3m: 1, ret_6m: 100, ret_1y: 100 }), PARAMS);
    expect(t(g)?.weak_flag).toBe(false);
  });

  it("weak_flag=null:指定窗口任一無資料", () => {
    const g = screenGroup(weakScenario({ ret_3m: 100, ret_6m: 1, ret_1y: null }), PARAMS);
    expect(t(g)?.weak_flag).toBeNull();
    expect(t(g)?.ladder.ret_1y_pct).toBeNull();
  });

  it("weakWindows 可指定 3m:僅看 3M 窗口", () => {
    const g = screenGroup(weakScenario({ ret_3m: 0, ret_6m: 100, ret_1y: 100 }), { ...PARAMS, weakWindows: ["3m"] });
    // ret_3m 最低(0 < 其他 1) → pct 0 < 40,長期好 → weak_flag true
    expect(t(g)?.weak_flag).toBe(true);
  });

  it("passed 依 sharpe_pct 由高到低排序", () => {
    // 讓多檔入選:每檔報酬/跌幅都勝過一個墊底的
    const base = { roi_y1: 1, roi_y2: 1, roi_y3: 1, roi_y4: 1, roi_y5: 1, maxdrop_y1: -50, maxdrop_y2: -50, maxdrop_y3: -50, maxdrop_y4: -50, maxdrop_y5: -50, sharpe_3y: 0.1 };
    const strong = (id: string, s: number) =>
      complete(id, { sharpe_3y: s, roi_y1: 9, roi_y2: 9, roi_y3: 9, roi_y4: 9, roi_y5: 9, maxdrop_y1: -1, maxdrop_y2: -1, maxdrop_y3: -1, maxdrop_y4: -1, maxdrop_y5: -1 });
    // 3 檔墊底讓年度中位數低於強檔,3 檔強檔皆入選
    const rows = [
      row({ fund_id: "Z", ...base }),
      row({ fund_id: "Y", ...base }),
      row({ fund_id: "X", ...base }),
      strong("P", 2),
      strong("Q", 4),
      strong("R", 3),
    ];
    const g = screenGroup(rows, PARAMS);
    const ids = g.passed.map((x) => x.fund_id);
    expect(ids).toEqual(["Q", "R", "P"]);
  });
});
