// 鉅亨買基金 Search/Detail 擷取與正規化
// 合約細節見 docs/research/2026-10-10-anue-fund-search-api.md

const ANUE_URL = "https://www.anuefund.com/anuefundApi/Search/Detail";
const NA = -99999999.9999; // 哨兵值 = 無資料

/** 哨兵值 / 空值 → null。絕不當 0。 */
export const num = (v: number | null | undefined): number | null =>
  v == null || v <= NA + 1 ? null : v;

/** 日期哨兵值處理：空值或以 1900- 開頭(鉅亨的假日期)→ null。 */
export const cleanDate = (d: string | null | undefined): string | null =>
  d && !d.startsWith("1900-") ? d : null;

export interface AnueRow {
  fundID: string;
  isinCode: string | null;
  lipperid: number | null;
  fundName: string | null;
  fundGroup: string | null;
  lippertW2_CHI: string | null;
  fundCcyCode: string | null;
  riskReturnRating: string | null;
  llsRatings: string | null;
  esG_Score: number | null;
  setup_date: string | null;
  fundtnA_TWD: number | null;
  nav: number | null;
  navDate: string | null;
  dataTime: string | null;
  perF_IMEJDate: string | null; // 月底基準日（境外基金 dataTime 為空時的 as_of 回退）
  std_DEVIATION_1YMEJ?: number;
  standarD_DEVIATION_1YMEJ: number | null;
  sharpE_RATIO_1YMEJ: number | null;
  sharpE_RATIO_3YMEJ: number | null;
  sharpE_RATIO_5YMEJ: number | null;
  sharpE_RATIO_10YMEJ: number | null;
  perF_3MMEJ: number | null;
  perF_6MMEJ: number | null;
  perF_1YMEJ: number | null;
  perF_3YMEJ: number | null;
  perF_5YMEJ: number | null;
  year_ROI1: number | null;
  year_ROI2: number | null;
  year_ROI3: number | null;
  year_ROI4: number | null;
  year_ROI5: number | null;
  year_MaxQuoteChange1: number | null;
  year_MaxQuoteChange2: number | null;
  year_MaxQuoteChange3: number | null;
  year_MaxQuoteChange4: number | null;
  year_MaxQuoteChange5: number | null;
}

interface AnueResponse {
  succ: boolean;
  code: string;
  message: string;
  dataTime: string;
  data: { dataCount: number; fundIDs: string; fundDatas: AnueRow[] } | null;
}

async function fetchPage(pageIndex: number, pageSize: number): Promise<AnueResponse> {
  const res = await fetch(ANUE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      condition: [],
      desc: true,
      fundIDs: "",
      pageIndex: String(pageIndex),
      pageSize,
      sortColumnName: "fundID", // 穩定排序，避免翻頁邊界重複/遺漏
    }),
  });
  if (!res.ok) throw new Error(`Anue HTTP ${res.status}`);
  const json = (await res.json()) as AnueResponse;
  if (!json.succ || !json.data) throw new Error(`Anue code ${json.code}: ${json.message}`);
  return json;
}

/** 抓全站所有基金。pageSize 上限實測 3000。 */
export async function fetchAllFunds(
  pageSize = 2000,
): Promise<{ rows: AnueRow[]; dataTime: string; dataCount: number }> {
  const first = await fetchPage(1, pageSize);
  const rows = [...first.data!.fundDatas];
  const total = first.data!.dataCount;
  const pages = Math.ceil(total / pageSize);
  for (let p = 2; p <= pages; p++) {
    const next = await fetchPage(p, pageSize);
    rows.push(...next.data!.fundDatas);
  }
  return { rows, dataTime: first.dataTime, dataCount: total };
}

// ── 投資區域（市場）對照 ──────────────────────────────────────────
// Search/Detail 的 fundDatas[] 無投資區域欄位；改以 InvestmentArea 篩選反查 data.fundIDs。

interface AnueConditionGroup {
  groupID: string;
  values?: { value: string }[];
}
interface AreaResponse {
  succ: boolean;
  code: string;
  message?: string;
  data: { fundIDs: string; condition?: { groups?: AnueConditionGroup[] } } | null;
}

async function post(body: Record<string, unknown>): Promise<AreaResponse> {
  const res = await fetch(ANUE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anue HTTP ${res.status}`);
  const json = (await res.json()) as AreaResponse;
  if (!json.succ || !json.data) throw new Error(`Anue code ${json.code}: ${json.message ?? ""}`);
  return json;
}

/** 逗號分隔的基金代碼字串 → 陣列（去空白、濾空）。 */
export function parseFundIDs(csv: string | null | undefined): string[] {
  return (csv ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** 從回應的 data.condition.groups 取 InvestmentArea 的區域清單（不寫死）。 */
export function parseAreaList(
  data: { condition?: { groups?: AnueConditionGroup[] } } | null | undefined,
): string[] {
  const g = data?.condition?.groups?.find((x) => x.groupID === "InvestmentArea");
  return (g?.values ?? []).map((v) => v.value).filter(Boolean);
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
 */
export async function fetchInvestmentAreaMap(): Promise<{
  areaOf: Map<string, string>;
  warnings: string[];
  errors: string[];
}> {
  const errors: string[] = [];
  const first = await post({ condition: [], ...AREA_PROBE });
  const areas = parseAreaList(first.data);

  const assignments: { area: string; fundIDs: string[] }[] = [];
  for (const area of areas) {
    try {
      const r = await post({ condition: [{ groupID: "InvestmentArea", parameterValue: area }], ...AREA_PROBE });
      assignments.push({ area, fundIDs: parseFundIDs(r.data!.fundIDs) });
    } catch (e) {
      errors.push(`${area}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const { areaOf, warnings } = buildAreaMap(assignments);
  return { areaOf, warnings, errors };
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
