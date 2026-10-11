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
