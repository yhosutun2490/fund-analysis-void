// 鉅亨回應中「已知但不消費」的欄位名快照（2026-10-22 對線上回應實測,僅欄位名、不含任何值）。
// 用途：區分加性變動。出現不在 schema 也不在此清單的欄位 → 記 warning（不中斷 ingest）。
// 鉅亨確實新增欄位且確認無害後,把欄位名補進對應清單即可消除 warning。

/** Search/Detail 頂層。 */
export const SEARCH_TOP = ["returnParam"] as const;

/** Search/Detail 的 data 全部欄位（各 schema 只消費其中一部分;已在 schema 內者以 schema 為準）。 */
export const SEARCH_DATA = ["dataCount", "fundIDs", "fundDatas", "groupAverage", "condition"] as const;

/** Search/Detail 的 data.condition 與其 groups[] / values[]。 */
export const CONDITION = ["specialGroups"] as const;
export const CONDITION_GROUP = ["groupName", "special"] as const;
export const CONDITION_VALUE = ["sort"] as const;

/** Search/Detail 的 data.fundDatas[]（實測每列 181 欄;此處為 normalize 未讀的部分）。 */
export const FUND_ROW = [
  "tscd", "perF_1DAYDesc", "perF_1DAY", "perF_1MMEJDesc", "perF_3MMEJDesc", "perF_6MMEJDesc", "perF_1YMEJDesc",
  "perF_2YMEJDesc", "perF_3YMEJDesc", "perF_5YMEJDesc", "perF_10YMEJDesc", "perF_YTMEJDesc", "perF_IMEJDesc",
  "perF_1MTDJDesc", "perF_3MTDJDesc", "perF_6MTDJDesc", "perF_1YTDJDesc", "perF_2YTDJDesc", "perF_3YTDJDesc",
  "perF_5YTDJDesc", "perF_10YTDJDesc", "perF_YTTDJDesc", "perF_ITDJDesc", "navDesc", "upDownDesc", "upDownRateDesc",
  "esG_ScoreDesc", "dividendPerShareDesc", "dividendPerShareDesc1", "dividendPerShareDesc2", "annualDividendYieldDesc",
  "annualDividendYieldDesc1", "annualDividendYieldDesc2", "llsRatingsDesc", "llsReturnDesc", "llsPreservationDesc",
  "fundTag", "fundNameLight", "score", "sStatus", "perF_1DAYDesc_CURR", "perF_1MMEJDesc_CURR", "perF_3MMEJDesc_CURR",
  "perF_6MMEJDesc_CURR", "perF_1YMEJDesc_CURR", "perF_2YMEJDesc_CURR", "perF_3YMEJDesc_CURR", "perF_5YMEJDesc_CURR",
  "perF_10YMEJDesc_CURR", "perF_YTMEJDesc_CURR", "perF_IMEJDesc_CURR", "perF_1MTDJDesc_CURR", "perF_3MTDJDesc_CURR",
  "perF_6MTDJDesc_CURR", "perF_1YTDJDesc_CURR", "perF_2YTDJDesc_CURR", "perF_3YTDJDesc_CURR", "perF_5YTDJDesc_CURR",
  "perF_10YTDJDesc_CURR", "perF_YTTDJDesc_CURR", "perF_ITDJDesc_CURR", "distributionCurrentDesc",
  "distributionCurrentDesc1", "distributionCurrentDesc2", "distributionCurrent_AnnDesc", "distributionCurrentRateDesc",
  "distributionCurrentRateDesc1", "distributionCurrentRateDesc2", "distributionCurrentRate_AnnDesc", "fundNameEng",
  "fundGroupEng", "fundCcyDesc", "alTable", "rsPable", "perF_1MMEJ", "perF_2YMEJ", "perF_10YMEJ", "perF_YTMEJ",
  "perF_IMEJ", "perF_1MTDJ", "perF_3MTDJ", "perF_6MTDJ", "perF_1YTDJ", "perF_2YTDJ", "perF_3YTDJ", "perF_5YTDJ",
  "perF_10YTDJ", "perF_YTTDJ", "perF_ITDJ", "perF_ITDJDate", "upDown", "upDownRate", "llsReturn", "llsPreservation",
  "recordDate", "dividendDate", "dividendDate1", "dividendDate2", "dividendPerShare", "dividendPerShare1",
  "dividendPerShare2", "dividendPerShare_Ann", "distributionCurrent", "distributionCurrent1", "distributionCurrent2",
  "distributionCurrent_Ann", "distributionCurrentRate", "distributionCurrentRate1", "distributionCurrentRate2",
  "distributionCurrentRate_Ann", "annualDividendYield", "annualDividendYield1", "annualDividendYield2",
  "dividendFrequency", "perF_1DAYCURR", "perF_1MMEJCURR", "perF_3MMEJCURR", "perF_6MMEJCURR", "perF_1YMEJCURR",
  "perF_2YMEJCURR", "perF_3YMEJCURR", "perF_5YMEJCURR", "perF_10YMEJCURR", "perF_YTMEJCURR", "perF_IMEJCURR",
  "perF_IMEJDateCURR", "perF_1MTDJCURR", "perF_3MTDJCURR", "perF_6MTDJCURR", "perF_1YTDJCURR", "perF_2YTDJCURR",
  "perF_3YTDJCURR", "perF_5YTDJCURR", "perF_10YTDJCURR", "perF_YTTDJCURR", "perF_ITDJCURR", "perF_ITDJDateCURR",
  "warn", "assetsTWD", "person", "show", "overSixMounth", "fundtna", "fundtnaDate", "fundtnaCurrency",
] as const;

/** FundDetail/Price 頂層。 */
export const PRICE_TOP = ["dataTime", "returnParam"] as const;
