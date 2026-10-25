// 鉅亨買基金 Search/Detail 擷取與正規化
// 合約細節見 docs/research/2026-10-10-anue-fund-search-api.md

import { z } from "zod";
import * as KNOWN from "./knownKeys";
import { AnueEnvelope, AnueSchemaError, parseAnue, parseAnueResponse, unknownKeysWarning, withKnownKeys } from "./schema";

const ANUE_URL = "https://www.anuefund.com/anuefundApi/Search/Detail";
const NA = -99999999.9999; // 哨兵值 = 無資料

/** 哨兵值 / 空值 → null。絕不當 0。 */
export const num = (v: number | null | undefined): number | null =>
  v == null || v <= NA + 1 ? null : v;

/** 日期哨兵值處理：空值或以 1900- 開頭(鉅亨的假日期)→ null。 */
export const cleanDate = (d: string | null | undefined): string | null =>
  d && !d.startsWith("1900-") ? d : null;

const nullableStr = z.string().nullable();
const nullableNum = z.number().nullable(); // 可能帶哨兵值 -99999999.9999,交給 num() 清理

/** fundDatas[] 中 normalize 會讀的欄位（鍵必在;值可為 null/哨兵）。其餘實測欄位見 anueKnownKeys。 */
const AnueRowSchema = withKnownKeys(
  z.object({
    fundID: z.string(),
    isinCode: nullableStr,
    lipperid: nullableNum,
    fundName: nullableStr,
    fundGroup: nullableStr,
    lippertW2_CHI: nullableStr,
    fundCcyCode: nullableStr,
    riskReturnRating: nullableStr,
    llsRatings: nullableStr,
    esG_Score: nullableNum,
    setup_date: nullableStr,
    fundtnA_TWD: nullableNum,
    nav: nullableNum,
    navDate: nullableStr,
    dataTime: nullableStr,
    perF_IMEJDate: nullableStr, // 月底基準日（境外基金 dataTime 為空時的 as_of 回退）
    standarD_DEVIATION_1YMEJ: nullableNum,
    sharpE_RATIO_1YMEJ: nullableNum,
    sharpE_RATIO_3YMEJ: nullableNum,
    sharpE_RATIO_5YMEJ: nullableNum,
    sharpE_RATIO_10YMEJ: nullableNum,
    perF_3MMEJ: nullableNum,
    perF_6MMEJ: nullableNum,
    perF_1YMEJ: nullableNum,
    perF_3YMEJ: nullableNum,
    perF_5YMEJ: nullableNum,
    year_ROI1: nullableNum,
    year_ROI2: nullableNum,
    year_ROI3: nullableNum,
    year_ROI4: nullableNum,
    year_ROI5: nullableNum,
    year_MaxQuoteChange1: nullableNum,
    year_MaxQuoteChange2: nullableNum,
    year_MaxQuoteChange3: nullableNum,
    year_MaxQuoteChange4: nullableNum,
    year_MaxQuoteChange5: nullableNum,
  }),
  KNOWN.FUND_ROW,
);
export type AnueRow = z.infer<typeof AnueRowSchema>;

const SearchResponse = withKnownKeys(
  AnueEnvelope.extend({
    dataTime: z.string(),
    data: withKnownKeys(z.object({ dataCount: z.number(), fundDatas: z.array(AnueRowSchema) }), KNOWN.SEARCH_DATA),
  }),
  KNOWN.SEARCH_TOP,
);
const SEARCH = "Search/Detail";

async function postSearch(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(ANUE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anue HTTP ${res.status}`);
  return res.json();
}

async function fetchPage(pageIndex: number, pageSize: number) {
  const json = await postSearch({
    condition: [],
    desc: true,
    fundIDs: "",
    pageIndex: String(pageIndex),
    pageSize,
    sortColumnName: "fundID", // 穩定排序，避免翻頁邊界重複/遺漏
  });
  return parseAnueResponse(SearchResponse, json, SEARCH);
}

/** 抓全站所有基金。pageSize 上限實測 3000。 */
export async function fetchAllFunds(
  pageSize = 2000,
): Promise<{ rows: AnueRow[]; dataTime: string; dataCount: number; warnings: string[] }> {
  const first = await fetchPage(1, pageSize);
  const rows = [...first.body.data.fundDatas];
  const unknown = new Set(first.unknownKeys);
  const total = first.body.data.dataCount;
  const pages = Math.ceil(total / pageSize);
  for (let p = 2; p <= pages; p++) {
    const next = await fetchPage(p, pageSize);
    rows.push(...next.body.data.fundDatas);
    next.unknownKeys.forEach((k) => unknown.add(k));
  }
  const warnings = unknown.size ? [unknownKeysWarning(SEARCH, [...unknown])] : [];
  return { rows, dataTime: first.body.dataTime, dataCount: total, warnings };
}

// ── 投資區域（市場）對照 ──────────────────────────────────────────
// Search/Detail 的 fundDatas[] 無投資區域欄位；改以 InvestmentArea 篩選反查 data.fundIDs。

// 篩選維度群組:只釘 groupID;values 的結構只對 InvestmentArea 驗證（見 parseAreaList）,
// 其他我們不讀的維度改版不該讓區域對照失敗
const ConditionGroup = withKnownKeys(z.object({ groupID: z.string(), values: z.unknown() }), KNOWN.CONDITION_GROUP);
const AreaValues = z.array(withKnownKeys(z.object({ value: z.string() }), KNOWN.CONDITION_VALUE));
const AREA_VALUES_PATH = "data.condition.groups[InvestmentArea].values";

// 區域查詢不讀頂層 dataTime,故兩支 schema 只釘各自消費的部分
const AREA_TOP = [...KNOWN.SEARCH_TOP, "dataTime"];
const areaResponse = <T extends z.ZodRawShape>(data: T) =>
  withKnownKeys(
    AnueEnvelope.extend({ data: withKnownKeys(z.object(data), KNOWN.SEARCH_DATA) }),
    AREA_TOP,
  );
/** 空 condition 的探測:讀 data.condition.groups 取區域清單。 */
const AreaListResponse = areaResponse({
  condition: withKnownKeys(z.object({ groups: z.array(ConditionGroup) }), KNOWN.CONDITION),
});
/** 單區探測:讀 data.fundIDs。 */
const AreaProbeResponse = areaResponse({ fundIDs: z.string() });

/** 逗號分隔的基金代碼字串 → 陣列（去空白、濾空）。 */
export function parseFundIDs(csv: string | null | undefined): string[] {
  return (csv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * 從 data.condition.groups 取 InvestmentArea 的區域清單（不寫死）。
 * 找不到該群組或其 values 結構不符 → AnueSchemaError（不默默當成 0 個區域）。
 */
export function parseAreaList(groups: { groupID: string; values?: unknown }[]): { areas: string[]; unknownKeys: string[] } {
  const g = groups.find((x) => x.groupID === "InvestmentArea");
  if (!g) throw new AnueSchemaError(`鉅亨 ${SEARCH} 回應格式不符: data.condition.groups 找不到 InvestmentArea`);
  const r = parseAnue(AreaValues, g.values, `${SEARCH} ${AREA_VALUES_PATH}`);
  return {
    areas: r.body.map((v) => v.value).filter(Boolean),
    unknownKeys: r.unknownKeys.map((k) => AREA_VALUES_PATH + k),
  };
}

/** 由各區域的 fundIDs 建立 fund_id → area 對照；一檔多區域取第一個並記 warning。 */
export function buildAreaMap(
  assignments: { area: string; fundIDs: string[] }[],
): { areaOf: Map<string, string>; warnings: string[] } {
  const areaOf = new Map<string, string>();
  const warnings: string[] = [];
  for (const { area, fundIDs } of assignments) {
    for (const id of fundIDs) {
      const existing = areaOf.get(id);
      if (existing === undefined) areaOf.set(id, area);
      else warnings.push(`${id} 同時屬於 ${existing} 與 ${area}，取前者`);
    }
  }
  return { areaOf, warnings };
}

const AREA_PROBE = { desc: true, fundIDs: "", pageIndex: "1", pageSize: 1, sortColumnName: "fundID" };

/**
 * 建立全站 fund_id → 投資區域對照。
 * 先以空 condition 取區域清單,再逐區以 pageSize:1 查 data.fundIDs。
 * 單區查詢失敗記入 errors 不拋出（呼叫端據此決定是否更新區域欄）。
 * warnings = 區域歸屬警告;upstreamWarnings = 鉅亨加性變動（與區域成敗無關,呼叫端應一律記錄）。
 */
export async function fetchInvestmentAreaMap(): Promise<{
  areaOf: Map<string, string>;
  warnings: string[];
  errors: string[];
  upstreamWarnings: string[];
}> {
  const errors: string[] = [];
  const first = parseAnueResponse(AreaListResponse, await postSearch({ condition: [], ...AREA_PROBE }), SEARCH);
  const { areas, unknownKeys } = parseAreaList(first.body.data.condition.groups);
  const unknown = new Set([...first.unknownKeys, ...unknownKeys]);

  const assignments: { area: string; fundIDs: string[] }[] = [];
  for (const area of areas) {
    try {
      const json = await postSearch({ condition: [{ groupID: "InvestmentArea", parameterValue: area }], ...AREA_PROBE });
      const r = parseAnueResponse(AreaProbeResponse, json, SEARCH);
      r.unknownKeys.forEach((k) => unknown.add(k));
      assignments.push({ area, fundIDs: parseFundIDs(r.body.data.fundIDs) });
    } catch (e) {
      errors.push(`${area}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const { areaOf, warnings } = buildAreaMap(assignments);
  const upstreamWarnings = unknown.size ? [unknownKeysWarning(SEARCH, [...unknown])] : [];
  return { areaOf, warnings, errors, upstreamWarnings };
}

export interface FundRecord {
  fund: {
    fund_id: string;
    isin: string | null;
    lipper_id: number | null;
    name: string;
    fund_group: string | null;
    category: string | null;
    currency: string | null;
    domicile: string;
    rr: string | null;
    esg_score: number | null;
    setup_date: string | null;
    aum_twd: number | null;
  };
  risk: {
    as_of: string | null;
    std_1y: number | null;
    sharpe_1y: number | null;
    sharpe_3y: number | null;
    sharpe_5y: number | null;
    sharpe_10y: number | null;
    ret_3m: number | null;
    ret_6m: number | null;
    ret_1y: number | null;
    ret_3y: number | null;
    ret_5y: number | null;
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
    lipper_total: string | null;
    nav: number | null;
    nav_date: string | null;
  };
}

/** 一列原始回應 → 正規化記錄（哨兵值轉 null）。 */
export function normalize(r: AnueRow): FundRecord {
  const lt = r.llsRatings && r.llsRatings !== "0" && r.llsRatings !== "-" ? r.llsRatings : null;
  return {
    fund: {
      fund_id: r.fundID,
      isin: r.isinCode || null,
      lipper_id: r.lipperid ?? null,
      name: r.fundName ?? r.fundID,
      fund_group: r.fundGroup || null,
      category: r.lippertW2_CHI || null,
      currency: r.fundCcyCode || null,
      domicile: r.fundID.startsWith("A") ? "onshore" : r.fundID.startsWith("B") ? "offshore" : "unknown",
      rr: r.riskReturnRating || null,
      esg_score: num(r.esG_Score),
      setup_date: r.setup_date || null,
      aum_twd: num(r.fundtnA_TWD),
    },
    risk: {
      // 境內用 dataTime（指標截止日，月更）；境外該欄為空，回退到月底基準日/淨值日
      // 1900- 開頭為鉅亨哨兵值，逐一清掉後取第一個有效日期
      as_of: cleanDate(r.dataTime) || cleanDate(r.perF_IMEJDate) || cleanDate(r.navDate) || null,
      std_1y: num(r.standarD_DEVIATION_1YMEJ),
      sharpe_1y: num(r.sharpE_RATIO_1YMEJ),
      sharpe_3y: num(r.sharpE_RATIO_3YMEJ),
      sharpe_5y: num(r.sharpE_RATIO_5YMEJ),
      sharpe_10y: num(r.sharpE_RATIO_10YMEJ),
      ret_3m: num(r.perF_3MMEJ),
      ret_6m: num(r.perF_6MMEJ),
      ret_1y: num(r.perF_1YMEJ),
      ret_3y: num(r.perF_3YMEJ),
      ret_5y: num(r.perF_5YMEJ),
      roi_y1: num(r.year_ROI1),
      roi_y2: num(r.year_ROI2),
      roi_y3: num(r.year_ROI3),
      roi_y4: num(r.year_ROI4),
      roi_y5: num(r.year_ROI5),
      maxdrop_y1: num(r.year_MaxQuoteChange1),
      maxdrop_y2: num(r.year_MaxQuoteChange2),
      maxdrop_y3: num(r.year_MaxQuoteChange3),
      maxdrop_y4: num(r.year_MaxQuoteChange4),
      maxdrop_y5: num(r.year_MaxQuoteChange5),
      lipper_total: lt,
      nav: num(r.nav),
      nav_date: cleanDate(r.navDate),
    },
  };
}
