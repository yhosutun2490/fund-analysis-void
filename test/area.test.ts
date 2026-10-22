import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAreaMap, fetchInvestmentAreaMap, parseAreaList, parseFundIDs } from "../src/anue";

describe("parseFundIDs", () => {
  it("逗號分隔、去空白、濾空", () => {
    expect(parseFundIDs("A01, B02 ,, C03 ")).toEqual(["A01", "B02", "C03"]);
  });
  it("null / 空字串 → []", () => {
    expect(parseFundIDs(null)).toEqual([]);
    expect(parseFundIDs("")).toEqual([]);
  });
});

// 實測結構(2026-10-22):groups[] = { groupID, groupName, special, values: [{ sort, value }] }
const group = (groupID: string, values: string[]) => ({
  groupID, groupName: groupID, special: false, values: values.map((value, i) => ({ sort: i, value })),
});

describe("parseAreaList — 取自 condition.groups,不寫死", () => {
  it("擷取 InvestmentArea 的 values[].value 清單", () => {
    expect(parseAreaList([group("AssetType", ["股票型"]), group("InvestmentArea", ["全球", "亞洲"])]).areas).toEqual(["全球", "亞洲"]);
  });
  it("其他篩選維度的結構不影響(只釘 InvestmentArea)", () => {
    const odd = { groupID: "DivFreq", values: [{ value: 12 }] };
    expect(parseAreaList([odd, group("InvestmentArea", ["亞洲"])]).areas).toEqual(["亞洲"]);
  });
  it("找不到 InvestmentArea 群組 → 格式錯誤(不再默默當成 0 個區域)", () => {
    expect(() => parseAreaList([group("AssetType", ["股票型"])])).toThrow(/格式不符.*InvestmentArea/);
  });
});

describe("buildAreaMap", () => {
  it("每檔對到其區域", () => {
    const { areaOf, warnings } = buildAreaMap([
      { area: "亞洲", fundIDs: ["A", "B"] },
      { area: "歐洲", fundIDs: ["C"] },
    ]);
    expect(areaOf.get("A")).toBe("亞洲");
    expect(areaOf.get("C")).toBe("歐洲");
    expect(warnings).toHaveLength(0);
  });
  it("一檔多區域 → 取第一個並記 warning", () => {
    const { areaOf, warnings } = buildAreaMap([
      { area: "亞洲", fundIDs: ["X"] },
      { area: "新興市場", fundIDs: ["X"] },
    ]);
    expect(areaOf.get("X")).toBe("亞洲");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("X");
  });
});

afterEach(() => vi.unstubAllGlobals());

// 依 request body 的 condition 回傳對應假資料
function stubAnue(handler: (body: any) => unknown) {
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    return { ok: true, json: async () => handler(body) } as Response;
  });
}

describe("fetchInvestmentAreaMap — 單區失敗不拋出", () => {
  it("某區查詢失敗 → 記入 errors,其餘區域照常建對照", async () => {
    stubAnue((body) => {
      // 第一次(condition 空)回區域清單
      if (body.condition.length === 0) {
        return {
          succ: true,
          code: "00000",
          data: { fundIDs: "", condition: { groups: [group("InvestmentArea", ["亞洲", "歐洲"])] } },
        };
      }
      const area = body.condition[0].parameterValue;
      if (area === "歐洲") return { succ: false, code: "00999", message: "參數超限", data: null };
      return { succ: true, code: "00000", data: { fundIDs: "A01,A02" } };
    });

    const { areaOf, errors } = await fetchInvestmentAreaMap();
    expect(areaOf.get("A01")).toBe("亞洲");
    expect(areaOf.get("A02")).toBe("亞洲");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("歐洲");
  });
});

describe("fetchInvestmentAreaMap — 上游契約驗證", () => {
  const areaList = (groups: unknown[]) => ({ succ: true, code: "00000", data: { fundIDs: "", condition: { groups } } });

  it("區域清單結構改變(values[].value 改型別) → 丟出點名路徑的格式錯誤", async () => {
    stubAnue(() => areaList([{ groupID: "InvestmentArea", values: [{ sort: 1, value: 7 }] }]));
    await expect(fetchInvestmentAreaMap()).rejects.toThrow(/InvestmentArea.*格式不符.*\[0\]\.value/);
  });

  it("區域清單 condition 不見 → 格式錯誤(不再默默當成 0 個區域)", async () => {
    stubAnue(() => ({ succ: true, code: "00000", data: { fundIDs: "" } }));
    await expect(fetchInvestmentAreaMap()).rejects.toThrow(/格式不符.*condition/);
  });

  it("單區回應格式不符 → 記入 errors(點名格式問題),其餘區域照常", async () => {
    stubAnue((body) => {
      if (body.condition.length === 0) return areaList([group("InvestmentArea", ["亞洲", "歐洲"])]);
      const area = body.condition[0].parameterValue;
      return { succ: true, code: "00000", data: { fundIDs: area === "歐洲" ? 123 : "A01" } };
    });
    const { areaOf, errors } = await fetchInvestmentAreaMap();
    expect(areaOf.get("A01")).toBe("亞洲");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/歐洲.*格式不符.*fundIDs/);
  });

  it("多出未知欄位 → 不丟錯,upstreamWarnings 點名欄位(與區域 warning 分開)", async () => {
    stubAnue((body) => {
      if (body.condition.length === 0) {
        const ia = group("InvestmentArea", ["亞洲"]);
        return areaList([{ ...ia, brandNew: 1, values: ia.values.map((v) => ({ ...v, alsoNew: 1 })) }]);
      }
      return { succ: true, code: "00000", data: { fundIDs: "A01" } };
    });
    const { areaOf, warnings, upstreamWarnings, errors } = await fetchInvestmentAreaMap();
    expect(areaOf.get("A01")).toBe("亞洲");
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(upstreamWarnings.join(" ")).toContain("data.condition.groups[].brandNew");
    expect(upstreamWarnings.join(" ")).toContain("data.condition.groups[InvestmentArea].values[].alsoNew");
  });
});
