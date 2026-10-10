import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";

const client = testClient(app);

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

  it("GET /api/analyze 缺 category 回 400", async () => {
    const res = await app.request("/api/analyze");
    expect(res.status).toBe(400);
  });

  it("未知路徑回 404", async () => {
    const res = await app.request("/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("/api/* 帶 CORS 標頭", async () => {
    const res = await app.request("/api/analyze", {
      headers: { Origin: "http://example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
