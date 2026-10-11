import { describe, expect, it } from "vitest";
import { type AnueRow, normalize } from "../src/anue";

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
