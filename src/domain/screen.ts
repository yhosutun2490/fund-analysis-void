// 第一段「快照初篩」的純計算（描述性,非投資建議）。
// 口徑：同組 = 同 category + 同 currency；百分位、中位數一律以完整組計算。
// year_ROI*/year_MaxQuoteChange* 口徑未驗證,僅供同組相對比較（basis: anue_year_fields_unverified）。

export interface ScreenRow {
  fund_id: string;
  name: string;
  category: string | null;
  currency: string | null;
  rr: string | null;
  as_of: string | null;
  sharpe_3y: number | null;
  roi_y1: number | null;
  roi_y2: number | null;
  roi_y3: number | null;
  roi_y4: number | null;
  roi_y5: number | null;
  maxdrop_y1: number | null;
  maxdrop_y2: number | null;
  maxdrop_y3: number | null;
  maxdrop_y4: number | null;
  maxdrop_y5: number | null;
  ret_3m: number | null;
  ret_6m: number | null;
  ret_1y: number | null;
  // fund_series 全期間摘要（left join;未分析為 null）
  rec_series_end?: string | null;
  rec_mdd?: number | null;
  rec_mdd_recovered?: number | null;
  rec_mdd_underwater_days?: number | null;
  rec_still_underwater_ratio?: number | null;
  rec_loss_prob_1y?: number | null;
}

export interface RecoverySummary {
  mdd: number | null;
  mdd_recovered: boolean | null;
  mdd_underwater_days: number | null;
  still_underwater_ratio: number | null;
  loss_prob_1y: number | null;
  series_end: string;
}

export type Window = "3m" | "6m" | "1y";

export interface ScreenParams {
  minSharpePct: number;
  minDropPct: number;
  minWins: number;
  weakPct?: number; // 預設 40
  weakWindows?: Window[]; // 預設 ["6m", "1y"]
}

export interface Ladder {
  ret_3m_pct: number | null;
  ret_6m_pct: number | null;
  ret_1y_pct: number | null;
}

export interface PassedFund {
  fund_id: string;
  name: string;
  rr: string | null;
  as_of: string | null;
  sharpe_pct: number | null;
  worst_drop: number | null;
  worst_drop_pct: number | null;
  wins: number;
  win_years: number;
  ladder: Ladder;
  weak_flag: boolean | null;
  reasons: string[];
  recovery: RecoverySummary | null; // 已分析過 → 全期間摘要,否則 null
}

export interface InsufficientFund {
  fund_id: string;
  name: string;
  reason: "peer_group_too_small" | "missing_sharpe_3y" | "fewer_than_3_years";
}

export interface GroupResult {
  category: string | null;
  currency: string | null;
  peer_count: number; // 完整組樣本數（不受篩選影響）
  matched_count: number; // 篩選後屬於本組的檔數
  passed: PassedFund[];
  rejected_count: number;
  insufficient: InsufficientFund[];
}

const MIN_PEER = 5;

const roiYears = (r: ScreenRow) => [r.roi_y1, r.roi_y2, r.roi_y3, r.roi_y4, r.roi_y5];
const dropYears = (r: ScreenRow) => [r.maxdrop_y1, r.maxdrop_y2, r.maxdrop_y3, r.maxdrop_y4, r.maxdrop_y5];
const nonNull = (xs: (number | null)[]) => xs.filter((v): v is number => v != null);

/** 中位數。空陣列 → null。 */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 組內百分位（0–100,越高越好）。
 * pct = (嚴格較差數 + 0.5×(同值數−1)) / (n−1) × 100。
 * `values` 須為同指標、已依「越高越好」方向排好的全部非空值（含 target 自身）。
 * 有效樣本 < 2 → null。
 */
export function percentRank(target: number, values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  let worse = 0;
  let equal = 0;
  for (const v of values) {
    if (v < target) worse++;
    else if (v === target) equal++;
  }
  return ((worse + 0.5 * (equal - 1)) / (n - 1)) * 100;
}

/** 某檔的最差年度跌幅 = 有值年度中的最小值（最負）。無值 → null。 */
function worstDrop(r: ScreenRow): number | null {
  const vals = nonNull(dropYears(r));
  return vals.length ? Math.min(...vals) : null;
}

/**
 * 對單一 (category, currency) 組做初篩。
 * 百分位、中位數一律以完整 `rows`（整組）計算；
 * `matchedIds` 只決定輸出哪些檔（範圍篩選不改變比較基準）,未給則全組皆輸出。
 */
export function screenGroup(rows: ScreenRow[], params: ScreenParams, matchedIds?: Set<string>): GroupResult {
  const category = rows[0]?.category ?? null;
  const currency = rows[0]?.currency ?? null;
  const peer_count = rows.length;
  const isMatched = (id: string) => (matchedIds ? matchedIds.has(id) : true);
  const matched = rows.filter((r) => isMatched(r.fund_id));
  const matched_count = matched.length;

  // 組太小：整組資料不足,不算百分位
  if (peer_count < MIN_PEER) {
    return {
      category,
      currency,
      peer_count,
      matched_count,
      passed: [],
      rejected_count: 0,
      insufficient: matched.map((r) => ({ fund_id: r.fund_id, name: r.name, reason: "peer_group_too_small" as const })),
    };
  }

  const weakPct = params.weakPct ?? 40;
  const weakWindows = params.weakWindows ?? (["6m", "1y"] as Window[]);

  // 指標的組內分佈（越高越好方向;null 不參與）
  const sharpeVals = nonNull(rows.map((r) => r.sharpe_3y));
  const dropVals = nonNull(rows.map((r) => worstDrop(r)));
  const ret3mVals = nonNull(rows.map((r) => r.ret_3m));
  const ret6mVals = nonNull(rows.map((r) => r.ret_6m));
  const ret1yVals = nonNull(rows.map((r) => r.ret_1y));
  // 各年度同組中位數（有值者）
  const yearMedians = [0, 1, 2, 3, 4].map((i) => median(nonNull(rows.map((r) => roiYears(r)[i]))));

  const passed: PassedFund[] = [];
  const insufficient: InsufficientFund[] = [];
  let rejected_count = 0;

  for (const r of rows) {
    // 範圍篩選：只輸出命中的檔（百分位已以完整組算好,不受影響）
    if (!isMatched(r.fund_id)) continue;

    // 規則 1：資料完整
    if (r.sharpe_3y == null) {
      insufficient.push({ fund_id: r.fund_id, name: r.name, reason: "missing_sharpe_3y" });
      continue;
    }
    if (nonNull(roiYears(r)).length < 3 || nonNull(dropYears(r)).length < 3) {
      insufficient.push({ fund_id: r.fund_id, name: r.name, reason: "fewer_than_3_years" });
      continue;
    }

    const sharpe_pct = percentRank(r.sharpe_3y, sharpeVals);
    const drop = worstDrop(r);
    const worst_drop_pct = drop == null ? null : percentRank(drop, dropVals);

    let wins = 0;
    let win_years = 0;
    roiYears(r).forEach((v, i) => {
      if (v == null) return;
      win_years++;
      const m = yearMedians[i];
      if (m != null && v > m) wins++;
    });

    const pass =
      sharpe_pct != null &&
      sharpe_pct >= params.minSharpePct &&
      worst_drop_pct != null &&
      worst_drop_pct >= params.minDropPct &&
      wins >= params.minWins;

    if (!pass) {
      rejected_count++;
      continue;
    }

    const ladder: Ladder = {
      ret_3m_pct: r.ret_3m == null ? null : percentRank(r.ret_3m, ret3mVals),
      ret_6m_pct: r.ret_6m == null ? null : percentRank(r.ret_6m, ret6mVals),
      ret_1y_pct: r.ret_1y == null ? null : percentRank(r.ret_1y, ret1yVals),
    };
    const long_good = sharpe_pct >= 60 || wins >= 4;
    const weak_flag = computeWeakFlag(ladder, weakWindows, weakPct, long_good);
    const reasons = buildReasons(sharpe_pct, worst_drop_pct, wins, win_years);
    if (weak_flag) reasons.push(`近 ${weakWindows.map(labelOf).join("、")} 皆落後同組 ${100 - weakPct}% 以上`);

    passed.push({
      fund_id: r.fund_id,
      name: r.name,
      rr: r.rr,
      as_of: r.as_of,
      sharpe_pct,
      worst_drop: drop,
      worst_drop_pct,
      wins,
      win_years,
      ladder,
      weak_flag,
      reasons,
      recovery: recoveryOf(r),
    });
  }

  // 規則 5：依 sharpe_pct 由高到低,同值依 worst_drop_pct
  passed.sort((a, b) => (b.sharpe_pct! - a.sharpe_pct!) || (b.worst_drop_pct! - a.worst_drop_pct!));

  return { category, currency, peer_count, matched_count, passed, rejected_count, insufficient };
}

/** 由 left join 的 fund_series 摘要欄建 recovery 物件;未分析（無 series_end）→ null。 */
function recoveryOf(r: ScreenRow): RecoverySummary | null {
  if (!r.rec_series_end) return null;
  return {
    mdd: r.rec_mdd ?? null,
    mdd_recovered: r.rec_mdd_recovered == null ? null : r.rec_mdd_recovered !== 0,
    mdd_underwater_days: r.rec_mdd_underwater_days ?? null,
    still_underwater_ratio: r.rec_still_underwater_ratio ?? null,
    loss_prob_1y: r.rec_loss_prob_1y ?? null,
    series_end: r.rec_series_end,
  };
}

const labelOf = (w: Window) => ({ "3m": "3M", "6m": "6M", "1y": "1Y" })[w];
const pctOf = (ladder: Ladder, w: Window): number | null =>
  w === "3m" ? ladder.ret_3m_pct : w === "6m" ? ladder.ret_6m_pct : ladder.ret_1y_pct;

/**
 * 近期轉弱（只標記）：
 * - 指定窗口任一百分位為 null → 不判定（null）。
 * - recent_weak = 每個窗口百分位皆 < weakPct；weak_flag = long_good && recent_weak。
 */
function computeWeakFlag(ladder: Ladder, windows: Window[], weakPct: number, longGood: boolean): boolean | null {
  const pcts = windows.map((w) => pctOf(ladder, w));
  if (pcts.some((p) => p == null)) return null;
  const recentWeak = pcts.every((p) => (p as number) < weakPct);
  return longGood && recentWeak;
}

function buildReasons(sharpePct: number, dropPct: number | null, wins: number, winYears: number): string[] {
  const reasons = [`3Y 夏普同組前 ${Math.round(100 - sharpePct)}%`];
  if (dropPct != null) reasons.push(`最差年度跌幅同組前 ${Math.round(100 - dropPct)}%`);
  reasons.push(`${winYears} 個年度中 ${wins} 年贏同組中位數`);
  return reasons;
}

/** 依 (category, currency) 分組,各組套 screenGroup。 */
export function screenGroups(rows: ScreenRow[], params: ScreenParams, matchedIds?: Set<string>): GroupResult[] {
  const groups = new Map<string, ScreenRow[]>();
  for (const r of rows) {
    const key = `${r.category ?? ""} ${r.currency ?? ""}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  }
  return [...groups.values()]
    .map((g) => screenGroup(g, params, matchedIds))
    .filter((g) => g.matched_count > 0);
}
