import { afterEach, describe, expect, it, vi } from "vitest";
import { type AnueRow, fetchAllFunds, normalize } from "../src/anue/search";

const NA = -99999999.9999;

// 最小列：只放被測欄位,其餘交給 normalize 的 null 處理
function row(partial: Partial<AnueRow>): AnueRow {
  return { fundID: "A00001", ...partial } as AnueRow;
}

describe("normalize — ticket 01", () => {
  it("擷取近 3 個月 / 6 個月報酬(perF_3MMEJ / perF_6MMEJ)", () => {
    const r = normalize(row({ perF_3MMEJ: 4.2, perF_6MMEJ: -1.5 }));
    expect(r.risk.ret_3m).toBe(4.2);
    expect(r.risk.ret_6m).toBe(-1.5);
  });

  it("ret_3m / ret_6m 哨兵值 → null(不當 0)", () => {
    const r = normalize(row({ perF_3MMEJ: NA, perF_6MMEJ: NA }));
    expect(r.risk.ret_3m).toBeNull();
    expect(r.risk.ret_6m).toBeNull();
  });

  it("ret_3m / ret_6m 缺值 → null", () => {
    const r = normalize(row({}));
    expect(r.risk.ret_3m).toBeNull();
    expect(r.risk.ret_6m).toBeNull();
  });

  it("nav_date 以 1900- 開頭 → null", () => {
    const r = normalize(row({ navDate: "1900-01-01" }));
    expect(r.risk.nav_date).toBeNull();
  });

  it("nav_date 正常日期保留", () => {
    const r = normalize(row({ navDate: "2026-10-09" }));
    expect(r.risk.nav_date).toBe("2026-10-09");
  });

  it("as_of 的 dataTime 為 1900- 哨兵值時,回退到下一個有效日期", () => {
    const r = normalize(row({ dataTime: "1900-01-01", perF_IMEJDate: "2026-09-30" }));
    expect(r.risk.as_of).toBe("2026-09-30");
  });

  it("as_of 所有來源皆為 1900- 哨兵值 → null", () => {
    const r = normalize(
      row({ dataTime: "1900-01-01", perF_IMEJDate: "1900-01-01", navDate: "1900-01-01" }),
    );
    expect(r.risk.as_of).toBeNull();
  });
});

afterEach(() => vi.unstubAllGlobals());

// normalize 會讀的欄位皆在、型別同實測(2026-10-22)的一列
function liveRow(fundID: string, extra: Record<string, unknown> = {}) {
  return {
    fundID, isinCode: "TW0000000001", lipperid: 1, fundName: "f", fundGroup: "股票型", lippertW2_CHI: "台灣股票",
    fundCcyCode: "TWD", riskReturnRating: "RR4", llsRatings: "3", esG_Score: NA, setup_date: "2000-01-01",
    fundtnA_TWD: 1, nav: 10, navDate: "2026-10-21", dataTime: "2026-09-30", perF_IMEJDate: "2026-09-30",
    standarD_DEVIATION_1YMEJ: 1, sharpE_RATIO_1YMEJ: 1, sharpE_RATIO_3YMEJ: 1, sharpE_RATIO_5YMEJ: 1, sharpE_RATIO_10YMEJ: NA,
    perF_3MMEJ: 1, perF_6MMEJ: 1, perF_1YMEJ: 1, perF_3YMEJ: 1, perF_5YMEJ: 1,
    year_ROI1: 1, year_ROI2: 1, year_ROI3: 1, year_ROI4: 1, year_ROI5: 1,
    year_MaxQuoteChange1: 1, year_MaxQuoteChange2: 1, year_MaxQuoteChange3: 1, year_MaxQuoteChange4: 1, year_MaxQuoteChange5: 1,
    fundNameLight: "f", assetsTWD: 1, // 已知但不消費的欄位
    ...extra,
  };
}

const searchResponse = (fundDatas: unknown[], dataExtra: Record<string, unknown> = {}) => ({
  succ: true, code: "00000", message: "", dataTime: "2026-10-22", returnParam: [],
  data: { dataCount: fundDatas.length, fundIDs: "", fundDatas, groupAverage: {}, condition: { groups: [] }, ...dataExtra },
});

const respond = (json: unknown) =>
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => json }) as Response);

describe("fetchAllFunds — 上游契約驗證", () => {
  it("良好 payload 照舊解析,無 warning", async () => {
    respond(searchResponse([liveRow("A01"), liveRow("B02")]));
    const r = await fetchAllFunds(2000);
    expect(r.rows.map((x) => x.fundID)).toEqual(["A01", "B02"]);
    expect(r.dataTime).toBe("2026-10-22");
    expect(r.dataCount).toBe(2);
    expect(r.warnings).toEqual([]);
  });

  it("已知欄位改型別 → 丟出點名該列與欄位的格式錯誤", async () => {
    respond(searchResponse([liveRow("A01"), liveRow("B02", { nav: "10.5" })]));
    await expect(fetchAllFunds(2000)).rejects.toThrow(/格式不符.*data\.fundDatas\[1\]\.nav/);
  });

  it("已知欄位被移除 → 格式錯誤", async () => {
    const { sharpE_RATIO_3YMEJ: _gone, ...row } = liveRow("A01");
    respond(searchResponse([row]));
    await expect(fetchAllFunds(2000)).rejects.toThrow(/格式不符.*sharpE_RATIO_3YMEJ/);
  });

  it("必填處變 null(fundID) → 格式錯誤", async () => {
    respond(searchResponse([liveRow("A01", { fundID: null })]));
    await expect(fetchAllFunds(2000)).rejects.toThrow(/格式不符.*fundID/);
  });

  it("整包結構改變(fundDatas 不見) → 格式錯誤", async () => {
    const res = searchResponse([]) as { data: Record<string, unknown> };
    delete res.data.fundDatas;
    respond(res);
    await expect(fetchAllFunds(2000)).rejects.toThrow(/格式不符.*fundDatas/);
  });

  it("可為空的欄位帶 null / 哨兵值仍可通過(清理留給 normalize)", async () => {
    respond(searchResponse([liveRow("B01", { fundGroup: null, nav: NA, navDate: "1900-01-01" })]));
    const r = await fetchAllFunds(2000);
    expect(normalize(r.rows[0]).risk.nav).toBeNull();
  });

  it("多出未知欄位 → 不丟錯,warning 點名欄位(逐列合併為一則)", async () => {
    respond(searchResponse([liveRow("A01", { brandNew: 1 }), liveRow("A02", { brandNew: 2 })], { alsoNew: true }));
    const r = await fetchAllFunds(2000);
    expect(r.rows).toHaveLength(2);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("data.fundDatas[].brandNew");
    expect(r.warnings[0]).toContain("data.alsoNew");
  });
});
