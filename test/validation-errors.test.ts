import { describe, expect, it } from "vitest";
import { request } from "./entry";
import { ValidationErrorResponse } from "../src/schemas/shared";

// 400 回歸測試:鎖住 Void withValidator 的標準形狀(slot + 逐字的 zh-TW 訊息)。
// 驗證在 handler 之前就失敗,不會碰到 DB,所以不需要 mock。
async function body400(path: string) {
  const res = await request(path, {}, { DB: {} as D1Database });
  expect(res.status).toBe(400);
  return ValidationErrorResponse.parse(await res.json());
}

describe("GET /api/screen — 400", () => {
  it("範圍參數全無 → schema 層級 refine 錯誤,path 為空", async () => {
    expect(await body400("/api/screen")).toEqual({
      error: "Validation failed",
      issues: [{ slot: "query", issues: [{ message: "category / area / group 至少擇一（決定篩選範圍）", path: "" }] }],
    });
  });

  it("欄位錯誤點名參數;所有失敗的 issue 都列出", async () => {
    expect(await body400("/api/screen?category=台灣股票&maxRr=9&minWins=9")).toEqual({
      error: "Validation failed",
      issues: [
        {
          slot: "query",
          issues: [
            { message: "maxRr 須為 1–5 的數值", path: "maxRr" },
            { message: "minWins 須為 0–5 的數值", path: "minWins" },
          ],
        },
      ],
    });
  });
});

describe("GET /api/funds — 400", () => {
  it("limit 非整數 → query slot 點名 limit", async () => {
    expect(await body400("/api/funds?limit=2.5")).toEqual({
      error: "Validation failed",
      issues: [{ slot: "query", issues: [{ message: "limit 須為非負整數", path: "limit" }] }],
    });
  });
});

describe("GET /api/funds/:id/recovery — 400", () => {
  it("from 晚於 to → schema 層級 refine 錯誤,path 為空", async () => {
    expect(await body400("/api/funds/V1/recovery?from=2026-01-02&to=2026-01-01")).toEqual({
      error: "Validation failed",
      issues: [{ slot: "query", issues: [{ message: "from 不可晚於 to", path: "" }] }],
    });
  });

  it("minDepth 超出範圍 → query slot 點名 minDepth", async () => {
    expect(await body400("/api/funds/V1/recovery?minDepth=100")).toEqual({
      error: "Validation failed",
      issues: [{ slot: "query", issues: [{ message: "minDepth 須在 (0,100)", path: "minDepth" }] }],
    });
  });
});

// GET /api/funds/:id 與 /api/funds/:id/history 只驗 params(id 非空):router 不會讓空的 :id 段命中,
// 經 HTTP 打不出 400,所以沒有對應的回歸案例;params 的 400 schema 仍由 responds 把關。
