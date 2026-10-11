// 回復分析的純計算（含息指數序列 → 回撤、近期報酬）。
// 單位約定：比例／報酬／跌幅一律為小數（-0.31 = −31%）。日期為日曆日。

export type SeriesPoint = [string, number]; // [YYYY-MM-DD, 含息指數]

export interface Drawdown {
  depth: number | null; // 最大回撤(小數,負);資料不足 → null
  peak: string | null; // 谷底前最高點日期
  trough: string | null; // 谷底日期
  recovery: string | null; // 谷底後第一個 ≥ 前高的日期;未回復 → null
  recovered: boolean;
  recovery_days: number | null; // recovery − trough
  underwater_days: number | null; // recovery − peak;未回復時為 最後日 − peak
  gap_to_peak: number | null; // 未回復時 I_last/I_peak − 1,否則 null
}

const MS_PER_DAY = 86_400_000;

/** 兩個 YYYY-MM-DD 的日曆日差（b − a）。 */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / MS_PER_DAY);
}

const EMPTY_DD: Drawdown = {
  depth: null, peak: null, trough: null, recovery: null,
  recovered: false, recovery_days: null, underwater_days: null, gap_to_peak: null,
};

/** 最大回撤。points 須按日期升序。 */
export function computeMdd(points: SeriesPoint[]): Drawdown {
  if (points.length < 2) return { ...EMPTY_DD };

  let maxVal = points[0][1];
  let maxIdx = 0;
  let worst = 0; // 最深回撤(≤0)
  let troughIdx = -1;
  let peakIdx = -1;

  for (let i = 0; i < points.length; i++) {
    const v = points[i][1];
    if (v > maxVal) {
      maxVal = v;
      maxIdx = i;
    }
    const dd = v / maxVal - 1;
    if (dd < worst) {
      worst = dd;
      troughIdx = i;
      peakIdx = maxIdx;
    }
  }

  if (troughIdx < 0) return { ...EMPTY_DD, depth: 0, recovered: true };

  const peakVal = points[peakIdx][1];
  const peak = points[peakIdx][0];
  const trough = points[troughIdx][0];

  // 谷底後第一個 ≥ 前高
  let recoveryIdx = -1;
  for (let i = troughIdx + 1; i < points.length; i++) {
    if (points[i][1] >= peakVal) { recoveryIdx = i; break; }
  }

  const lastDate = points[points.length - 1][0];
  if (recoveryIdx < 0) {
    return {
      depth: worst, peak, trough, recovery: null, recovered: false,
      recovery_days: null,
      underwater_days: daysBetween(peak, lastDate),
      gap_to_peak: points[points.length - 1][1] / peakVal - 1,
    };
  }
  const recovery = points[recoveryIdx][0];
  return {
    depth: worst, peak, trough, recovery, recovered: true,
    recovery_days: daysBetween(trough, recovery),
    underwater_days: daysBetween(peak, recovery),
    gap_to_peak: null,
  };
}

/** 取窗口 [from, to]（含端點）;未給則回全序列。points 須升序。 */
export function sliceWindow(points: SeriesPoint[], from?: string, to?: string): SeriesPoint[] {
  return points.filter(([d]) => (from ? d >= from : true) && (to ? d <= to : true));
}

/** 由前高/谷底/回復索引組一筆回撤（recoveryIdx < 0 表示未回復,算到最後日）。 */
function episodeOf(points: SeriesPoint[], peakIdx: number, troughIdx: number, recoveryIdx: number): Drawdown {
  const peakVal = points[peakIdx][1];
  const peak = points[peakIdx][0];
  const trough = points[troughIdx][0];
  const depth = points[troughIdx][1] / peakVal - 1;
  if (recoveryIdx < 0) {
    const lastDate = points[points.length - 1][0];
    return {
      depth, peak, trough, recovery: null, recovered: false,
      recovery_days: null, underwater_days: daysBetween(peak, lastDate),
      gap_to_peak: points[points.length - 1][1] / peakVal - 1,
    };
  }
  const recovery = points[recoveryIdx][0];
  return {
    depth, peak, trough, recovery, recovered: true,
    recovery_days: daysBetween(trough, recovery),
    underwater_days: daysBetween(peak, recovery),
    gap_to_peak: null,
  };
}

/**
 * 回撤事件清單：把序列切成「前高 → 回到前高」的水下區段,
 * 取最深跌幅 ≥ minDepth(%) 者,依深度排序（最深在前）。
 */
export function computeEpisodes(points: SeriesPoint[], minDepthPct: number): Drawdown[] {
  const episodes: Drawdown[] = [];
  if (points.length < 2) return episodes;

  let peakIdx = 0;
  let troughIdx = -1; // 自上次前高以來的最深點
  for (let i = 1; i < points.length; i++) {
    const v = points[i][1];
    if (v >= points[peakIdx][1]) {
      if (troughIdx >= 0) episodes.push(episodeOf(points, peakIdx, troughIdx, i));
      peakIdx = i;
      troughIdx = -1;
    } else if (troughIdx < 0 || v < points[troughIdx][1]) {
      troughIdx = i;
    }
  }
  if (troughIdx >= 0) episodes.push(episodeOf(points, peakIdx, troughIdx, -1)); // 開放區段

  const threshold = -minDepthPct / 100;
  return episodes.filter((e) => (e.depth ?? 0) <= threshold).sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
}

export interface EventDef {
  key: string;
  start: string;
  end: string;
}

export const DEFAULT_EVENTS: EventDef[] = [
  { key: "covid_2020", start: "2020-01-01", end: "2020-06-30" },
  { key: "rate_hike_2022", start: "2022-01-01", end: "2022-12-31" },
  { key: "tariff_2025", start: "2025-03-01", end: "2025-05-31" },
];

export type EventResult = Drawdown | { reason: "not_covered" };

/**
 * 預設事件回撤：peak/trough 限事件區間內（peak 為谷底前區間內最高點）,
 * recovery 往後找到序列結束;窗口未完整覆蓋事件區間 → { reason: "not_covered" }。
 */
export function computeEvents(points: SeriesPoint[], events: EventDef[] = DEFAULT_EVENTS): Record<string, EventResult> {
  const out: Record<string, EventResult> = {};
  const first = points[0]?.[0];
  const last = points[points.length - 1]?.[0];

  for (const ev of events) {
    if (!first || !last || first > ev.start || last < ev.end) {
      out[ev.key] = { reason: "not_covered" };
      continue;
    }
    const inRange: number[] = [];
    for (let i = 0; i < points.length; i++) {
      if (points[i][0] >= ev.start && points[i][0] <= ev.end) inRange.push(i);
    }
    if (inRange.length < 2) {
      out[ev.key] = { reason: "not_covered" };
      continue;
    }
    // 區間內谷底,及其之前的區間內最高點
    let troughIdx = inRange[0];
    for (const i of inRange) if (points[i][1] < points[troughIdx][1]) troughIdx = i;
    let peakIdx = inRange[0];
    for (const i of inRange) {
      if (i > troughIdx) break;
      if (points[i][1] > points[peakIdx][1]) peakIdx = i;
    }
    // recovery 往後找（不限區間）
    const peakVal = points[peakIdx][1];
    let recoveryIdx = -1;
    for (let i = troughIdx + 1; i < points.length; i++) {
      if (points[i][1] >= peakVal) { recoveryIdx = i; break; }
    }
    out[ev.key] = episodeOf(points, peakIdx, troughIdx, recoveryIdx);
  }
  return out;
}

export interface RecentReturns {
  ret_3m: number | null;
  ret_6m: number | null;
  ret_1y: number | null;
}

/** 某 YYYY-MM-DD 往前 n 個月（日超出月底則留在月底）。 */
function monthsBefore(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() - n);
  if (d.getUTCDate() < day) d.setUTCDate(0); // 回退到上個月底,避免跨月進位
  return d.toISOString().slice(0, 10);
}

export type Holding = { loss_prob: number; worst: number; median: number } | { reason: "window_shorter_than_horizon" };

export interface LumpSum {
  still_underwater_ratio: number | null;
  longest_underwater_days: number | null;
  longest_underwater_entry: string | null;
  longest_underwater_open: boolean;
  holding: { "1y": Holding; "3y": Holding };
}

function addDays(dateStr: string, n: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 每個 index 右側第一個值 ≥ 自身的 index（單調堆疊,O(n)）;無則 -1。 */
function nextGreaterEqual(points: SeriesPoint[]): number[] {
  const n = points.length;
  const out = new Array<number>(n).fill(-1);
  const stack: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    while (stack.length && points[stack[stack.length - 1]][1] < points[i][1]) stack.pop();
    out[i] = stack.length ? stack[stack.length - 1] : -1;
    stack.push(i);
  }
  return out;
}

const medianOf = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 某持有期 H（日曆日）的虧損機率/最差/中位;窗口不足 H → reason。 */
function holdingStats(points: SeriesPoint[], horizonDays: number): Holding {
  const first = points[0][0];
  const last = points[points.length - 1][0];
  if (daysBetween(first, last) < horizonDays) return { reason: "window_shorter_than_horizon" };

  const rets: number[] = [];
  for (const [date, entryVal] of points) {
    const target = addDays(date, horizonDays);
    const end = valueAtOrAfter(points, target);
    if (end == null) continue; // 進場日太近窗口尾端,無期末資料
    rets.push(end / entryVal - 1);
  }
  if (rets.length === 0) return { reason: "window_shorter_than_horizon" };
  const losses = rets.filter((r) => r < 0).length;
  return { loss_prob: losses / rets.length, worst: Math.min(...rets), median: medianOf(rets) };
}

/** 單筆進場風險：仍虧損比例、最長回本天數、持有期虧損機率。 */
export function computeLumpSum(points: SeriesPoint[]): LumpSum {
  const empty: LumpSum = {
    still_underwater_ratio: null, longest_underwater_days: null,
    longest_underwater_entry: null, longest_underwater_open: false,
    holding: { "1y": { reason: "window_shorter_than_horizon" }, "3y": { reason: "window_shorter_than_horizon" } },
  };
  if (points.length < 2) return empty;

  const n = points.length;
  const lastVal = points[n - 1][1];
  const lastDate = points[n - 1][0];

  // 仍虧損比例：進場後至今 I_last < I_e
  let under = 0;
  for (const [, v] of points) if (lastVal < v) under++;
  const still_underwater_ratio = under / n;

  // 最長回本天數（以「下一個 ≥」求回本日;未回本算到最後日並標 open）
  const nge = nextGreaterEqual(points);
  let longest = 0;
  let entry: string | null = points[0][0];
  let open = false;
  for (let e = 0; e < n; e++) {
    let dur: number;
    let isOpen = false;
    if (e === n - 1 || nge[e] === e + 1) {
      dur = 0; // 下一點即回本 → 未進入水下
    } else if (nge[e] < 0) {
      dur = daysBetween(points[e][0], lastDate);
      isOpen = true;
    } else {
      dur = daysBetween(points[e][0], points[nge[e]][0]);
    }
    if (dur > longest) {
      longest = dur;
      entry = points[e][0];
      open = isOpen;
    }
  }

  return {
    still_underwater_ratio,
    longest_underwater_days: longest,
    longest_underwater_entry: entry,
    longest_underwater_open: open,
    holding: { "1y": holdingStats(points, 365), "3y": holdingStats(points, 1095) },
  };
}

/** points 中日期 ≥ target 的第一點值;無則 null。 */
function valueAtOrAfter(points: SeriesPoint[], target: string): number | null {
  for (const [date, v] of points) if (date >= target) return v;
  return null;
}

/** points 中日期 ≤ target 的最後一點值;無則 null。 */
function valueAtOrBefore(points: SeriesPoint[], target: string): number | null {
  let out: number | null = null;
  for (const [date, v] of points) {
    if (date <= target) out = v;
    else break;
  }
  return out;
}

/** 近期報酬 = I_last / I_{last−期間} − 1;last−期間 取該日或之前最近一點。 */
export function recentReturns(points: SeriesPoint[]): RecentReturns {
  if (points.length === 0) return { ret_3m: null, ret_6m: null, ret_1y: null };
  const [lastDate, lastVal] = points[points.length - 1];
  const at = (months: number): number | null => {
    const base = valueAtOrBefore(points, monthsBefore(lastDate, months));
    return base == null ? null : lastVal / base - 1;
  };
  return { ret_3m: at(3), ret_6m: at(6), ret_1y: at(12) };
}
