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

describe("parseAreaList — 取自 condition.groups,不寫死", () => {
  it("擷取 InvestmentArea 的 parameterValue 清單", () => {
    const data = {
      condition: {
        groups: [
          { groupID: "AssetType", parameters: [{ parameterValue: "股票型" }] },
          { groupID: "InvestmentArea", parameters: [{ parameterValue: "全球" }, { parameterValue: "亞洲" }] },
        ],
      },
    };
    expect(parseAreaList(data)).toEqual(["全球", "亞洲"]);
  });
  it("找不到 InvestmentArea → []", () => {
    expect(parseAreaList({ condition: { groups: [] } })).toEqual([]);
    expect(parseAreaList(null)).toEqual([]);
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
          data: { fundIDs: "", condition: { groups: [{ groupID: "InvestmentArea", parameters: [{ parameterValue: "亞洲" }, { parameterValue: "歐洲" }] }] } },
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
