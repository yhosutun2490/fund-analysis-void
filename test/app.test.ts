import { describe, expect, it } from "vitest";
import worker from "../src/index";

const env = {} as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as never;

function call(path: string, init?: RequestInit) {
  return worker.fetch(new Request(`http://localhost${path}`, init), env, ctx);
}

describe("worker http surface", () => {
  it("GET / 回服務資訊", async () => {
    const res = await call("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string;
      endpoints: string[];
      disclaimer: string;
    };
    expect(body.name).toBe("fund-risks-analysis");
    expect(Array.isArray(body.endpoints)).toBe(true);
    expect(body.disclaimer).toBeTruthy();
  });

  it("GET /api/analyze 缺 category 回 400", async () => {
    const res = await call("/api/analyze");
    expect(res.status).toBe(400);
  });

  it("未知路徑回 404", async () => {
    const res = await call("/does-not-exist");
    expect(res.status).toBe(404);
  });

  it("/api/* 帶 CORS 標頭", async () => {
    const res = await call("/api/analyze", {
      headers: { Origin: "http://example.com" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
