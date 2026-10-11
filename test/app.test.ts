import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";

const client = testClient(app);

// 空結果 D1:讓通過驗證的請求能跑到底(不連真 DB)
const emptyDB = {
  prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => null }) }),
} as unknown as D1Database;
const env = { DB: emptyDB };

describe("worker http surface", () => {
  it("GET / 回服務資訊(型別化回傳)", async () => {
    const res = await client.index.$get();
    expect(res.status).toBe(200);
    const body = await res.json();
    // body.name / body.endpoints / body.disclaimer 皆由 c.json(...) 推導出型別
    expect(body.name).toBe("fund-risks-analysis");
    expect(Array.isArray(body.endpoints)).toBe(true);
    expect(body.disclaimer).toBeTruthy();
  });

  it("GET /api/screen 缺 category/area/group 全無 回 400", async () => {
    const res = await app.request("/api/screen");
    expect(res.status).toBe(400);
  });

  it("GET /api/screen 只給 area 也可(不回 400)", async () => {
    const res = await app.request("/api/screen?area=亞洲", {}, env);
    expect(res.status).toBe(200);
  });

  it("GET /api/screen maxRr 超出 1–5 回 400", async () => {
    const res = await app.request("/api/screen?category=台灣股票&maxRr=9");
    expect(res.status).toBe(400);
  });

  it("GET /api/screen minSharpePct 超出 0–100 回 400", async () => {
    const res = await app.request("/api/screen?category=台灣股票&minSharpePct=200");
    expect(res.status).toBe(400);
  });

  it("GET /api/screen minWins 超出 0–5 回 400", async () => {
    const res = await app.request("/api/screen?category=台灣股票&minWins=9");
    expect(res.status).toBe(400);
  });

  it("GET /api/screen weakWindows 含非法窗口回 400", async () => {
    const res = await app.request("/api/screen?category=台灣股票&weakWindows=6m,2y");
    expect(res.status).toBe(400);
  });

  it("GET /api/screen weakPct 超出 0–100 回 400", async () => {
    const res = await app.request("/api/screen?category=台灣股票&weakPct=150");
    expect(res.status).toBe(400);
  });

  it("舊的 /api/analyze 已移除(404)", async () => {
    const res = await app.request("/api/analyze?category=台灣股票");
    expect(res.status).toBe(404);
  });

  it("未知路徑回 404", async () => {
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("/api/* 帶 CORS 標頭", async () => {
    const res = await app.request("/api/screen", {
      headers: { Origin: "http://example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
