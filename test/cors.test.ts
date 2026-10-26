import { describe, expect, it } from "vitest";
import { request } from "./entry";

const origin = { Origin: "http://example.com" };

describe("CORS(全域 middleware)", () => {
  it("/api/* 的 OPTIONS preflight 回 204 並帶 CORS 標頭", async () => {
    const res = await request("/api/funds", {
      method: "OPTIONS",
      headers: { ...origin, "Access-Control-Request-Method": "GET" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("/api/* 的一般 GET 帶 CORS 標頭", async () => {
    // 缺範圍參數 → 400,不需要 DB 也能檢查標頭
    const res = await request("/api/screen", { headers: origin });
    expect(res.status).toBe(400);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("/api/auth/* 的 OPTIONS preflight 不帶萬用 CORS", async () => {
    const res = await request("/api/auth/sign-in/email", {
      method: "OPTIONS",
      headers: { ...origin, "Access-Control-Request-Method": "POST" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each(["/api/auth", "/api/auth/get-session"])("%s 的一般請求不帶萬用 CORS", async (path) => {
    // 測試入口沒掛 Void 的 auth handler(回 404),這裡只檢查 CORS middleware 有沒有加標頭
    const res = await request(path, { headers: origin });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("前綴相似但不是 auth 的 /api 路徑照舊帶 CORS", async () => {
    const res = await request("/api/authors", { headers: origin });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("非 /api 路徑不套 CORS", async () => {
    const res = await request("/", { headers: origin });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});
