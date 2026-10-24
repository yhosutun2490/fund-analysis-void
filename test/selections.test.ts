import { describe, expect, it } from "vitest";
import { z } from "zod";
import { categoryCols, fundCols, fundListCols, riskCols, rowOf, runCols } from "../src/db/selections";

// rowOf 產生的列 schema 是 API 回應契約的一部分。快照鎖住「select 子句 → schema」的結果,
// 改寫 rowOf 或升級 drizzle-zod 時,任何欄位型別/nullable/鍵名的變化都會現形。
describe("rowOf：select 子句 → 一列的 schema", () => {
  it.each([
    ["fundCols", fundCols],
    ["riskCols", riskCols],
    ["fundListCols", fundListCols],
    ["categoryCols", categoryCols],
    ["runCols", runCols],
  ])("%s", (_name, selection) => {
    expect(z.toJSONSchema(rowOf(selection))).toMatchSnapshot();
  });

  it("鍵是 snake_case 別名,且跨表的 select 也能驗證一列", () => {
    const row = rowOf({ fund_id: fundListCols.fund_id, as_of: fundListCols.as_of });
    expect(row.parse({ fund_id: "A01", as_of: "2026-09-30" })).toEqual({ fund_id: "A01", as_of: "2026-09-30" });
    expect(row.safeParse({ fundId: "A01", as_of: "2026-09-30" }).success).toBe(false);
  });
});
