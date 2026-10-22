// 鉅亨 FundDetail/Price（PerformanceHIS = 含配息累積報酬 %）擷取與串接。
// 合約細節見 docs/research/2026-10-10-anue-fund-search-api.md。

import { z } from "zod";
import { PRICE_TOP } from "./anueKnownKeys";
import { AnueSchemaError, parseAnue, parseAnueResponse, unknownKeysWarning, withKnownKeys } from "./anueSchema";
import type { SeriesPoint } from "./recovery";

const PRICE_URL = "https://www.anuefund.com/anuefundApi/FundDetail/Price";
const CHUNK_YEARS = 3;
const MAX_CONCURRENCY = 4;
const SEGMENT_TIMEOUT_MS = 10_000;

const toEpoch = (s: string) => Date.parse(`${s}T00:00:00Z`);
const toISODate = (epoch: number) => new Date(epoch).toISOString().slice(0, 10);
const toAnueDate = (s: string) => s.replaceAll("-", "/");

/** 把 [from, to] 切成 ≤3 年的段落,交界日共用（下一段起點 = 上一段終點）。 */
export function chunkRanges(from: string, to: string, years = CHUNK_YEARS): [string, string][] {
  const out: [string, string][] = [];
  let start = from;
  while (toEpoch(start) < toEpoch(to)) {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + years);
    const cap = d.toISOString().slice(0, 10);
    const end = toEpoch(cap) < toEpoch(to) ? cap : to;
    out.push([start, end]);
    start = end;
  }
  return out;
}

/**
 * 串接各段（每段為 [[epoch, 累積報酬%]],起點 0）為含息指數序列。
 * `I_t = I_段起點 × (1 + p_t/100)`,第一段起點指數 1;交界重複日只留一個。
 * 前導空段跳過（基金尚未成立）;已開始後再遇空段（中段缺資料）→ 拋出,不拼接。
 */
export function spliceSegments(segments: [number, number][][]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let carry = 1;
  let started = false;
  for (const seg of segments) {
    if (seg.length === 0) {
      if (started) throw new Error("序列中段缺資料,不拼接");
      continue;
    }
    for (const [epoch, pct] of seg) {
      const date = toISODate(epoch);
      if (out.length && out[out.length - 1][0] === date) continue; // 交界去重
      out.push([date, carry * (1 + pct / 100)]);
    }
    carry = out[out.length - 1][1];
    started = true;
  }
  return out;
}

const PriceResponse = withKnownKeys(
  z.object({
    succ: z.boolean(),
    code: z.string(),
    message: z.string().nullish(),
    data: z.string(), // JSON 字串 "[[epoch, pct], …]",空字串 = 無資料
  }),
  PRICE_TOP,
);
const PriceSegment = z.array(z.tuple([z.number(), z.number()]));
const ENDPOINT = "FundDetail/Price";

/** data 字串 → [[epoch, pct]];JSON 壞掉或點的型別不符皆屬格式不符。 */
function parseSegment(raw: string): [number, number][] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AnueSchemaError(`鉅亨 ${ENDPOINT} 回應格式不符: data 不是合法 JSON`);
  }
  return parseAnue(PriceSegment, json, `${ENDPOINT} data`).data;
}

/** 抓單一段落,回 [[epoch, pct]];data 空字串 → []。每段逾時 10 秒。 */
async function fetchSegment(fundID: string, strDate: string, endDate: string): Promise<[number, number][]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEGMENT_TIMEOUT_MS);
  try {
    const res = await fetch(PRICE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        fundID,
        priceENUM: "PerformanceHIS",
        reload: false,
        chartFomatUse: true,
        strDate: toAnueDate(strDate),
        endDate: toAnueDate(endDate),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Anue HTTP ${res.status}`);
    const { data, unknownKeys } = parseAnueResponse(PriceResponse, await res.json(), ENDPOINT);
    if (unknownKeys.length) console.warn(unknownKeysWarning(ENDPOINT, unknownKeys));
    if (!data.data) return [];
    return parseSegment(data.data);
  } finally {
    clearTimeout(timer);
  }
}

/** 併發上限內依序取回各段結果（保持段落順序）。 */
async function fetchAll(fundID: string, ranges: [string, string][]): Promise<[number, number][][]> {
  const results: [number, number][][] = new Array(ranges.length);
  let next = 0;
  async function worker() {
    while (next < ranges.length) {
      const i = next++;
      results[i] = await fetchSegment(fundID, ranges[i][0], ranges[i][1]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, ranges.length) }, worker));
  return results;
}

/** 抓取含配息累積報酬序列並串接成日指數 `[date, index][]`。 */
export async function fetchTotalReturnSeries(fundID: string, from: string, to: string): Promise<SeriesPoint[]> {
  const ranges = chunkRanges(from, to);
  const segments = await fetchAll(fundID, ranges);
  return spliceSegments(segments);
}
