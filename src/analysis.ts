// 同類基金的相對風險分析（描述性工具，非投資建議）。
// 口徑一致性由呼叫端保證：同 category、同 currency、同 as_of 才放進同一組比較。

export interface RiskRow {
  fund_id: string;
  name: string;
  category: string | null;
  currency: string | null;
  rr: string | null;
  as_of: string | null;
  std_1y: number | null;
  sharpe_1y: number | null;
  sharpe_3y: number | null;
  ret_3y: number | null;
  maxdrop_y1: number | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** 把一個數值欄位轉成組內 z-score 對照表。higherIsBetter=false 時反號。 */
function zMap(rows: RiskRow[], pick: (r: RiskRow) => number | null, higherIsBetter: boolean): Map<string, number> {
  const vals = rows.map((r) => pick(r)).filter((v): v is number => v != null);
  const out = new Map<string, number>();
  if (vals.length < 2) return out;
  const m = mean(vals);
  const sd = stdev(vals);
  if (sd === 0) return out;
  for (const r of rows) {
    const v = pick(r);
    if (v == null) continue;
    const z = (v - m) / sd;
    out.set(r.fund_id, higherIsBetter ? z : -z);
  }
  return out;
}

export interface ScoredFund extends RiskRow {
  z_sharpe3y: number | null;
  z_std1y: number | null;
  z_maxdrop1y: number | null;
  score: number | null; // 加權合成的「相對穩健度」，僅在同組內有意義
  peer_count: number;
}

export interface AnalyzeOptions {
  // 權重：預設偏重風險調整後報酬（夏普）與下檔（最大跌幅），波動次之
  wSharpe?: number;
  wStd?: number;
  wMaxdrop?: number;
}

/**
 * 對同一可比較群組（同 category/currency）做相對評分。
 * - 夏普(3Y)：越高越好
 * - 標準差(1Y)：越低越好
 * - 年度最大跌幅：越接近 0 越好（值為負，higherIsBetter=true）
 * 只有三項皆有資料者才給 score；否則 score=null 並標示資料不足。
 */
export function analyzePeerGroup(rows: RiskRow[], opts: AnalyzeOptions = {}): ScoredFund[] {
  const wSharpe = opts.wSharpe ?? 0.5;
  const wStd = opts.wStd ?? 0.2;
  const wMaxdrop = opts.wMaxdrop ?? 0.3;

  const zSharpe = zMap(rows, (r) => r.sharpe_3y, true);
  const zStd = zMap(rows, (r) => r.std_1y, false);
  const zDrop = zMap(rows, (r) => r.maxdrop_y1, true);
  const peer = rows.length;

  const scored = rows.map((r) => {
    const zs = zSharpe.get(r.fund_id) ?? null;
    const zv = zStd.get(r.fund_id) ?? null;
    const zd = zDrop.get(r.fund_id) ?? null;
    const complete = zs != null && zv != null && zd != null;
    return {
      ...r,
      z_sharpe3y: zs,
      z_std1y: zv,
      z_maxdrop1y: zd,
      score: complete ? wSharpe * zs! + wStd * zv! + wMaxdrop * zd! : null,
      peer_count: peer,
    };
  });

  scored.sort((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  });
  return scored;
}
