import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import { app } from "../src/app";

const client = testClient(app);

// 空結果 D1:讓通過驗證的請求能跑到底(不連真 DB)。
// drizzle-d1 的 all() 底層走 raw(),故 stub 需自我回傳並提供 raw/all/run/first。
const stmt: Record<string, unknown> = {
  bind: () => stmt,
  all: async () => ({ results: [], success: true, meta: {} }),
  raw: async () => [],
  run: async () => ({ results: [], success: true, meta: {} }),
  first: async () => null,
};
const emptyDB = { prepare: () => stmt, batch: async () => [] } as unknown as D1Database;
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

// 400 + 一致的 { error } 形狀,訊息點名參數與有效範圍
async function expect400(path: string, ...mentions: string[]) {
  const res = await app.request(path, {}, env);
  expect(res.status).toBe(400);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(["error"]);
  expect(typeof body.error).toBe("string");
  for (const m of mentions) expect(body.error).toContain(m);
}

async function ok(path: string) {
  const res = await app.request(path, {}, env);
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

describe("GET /api/screen — 請求驗證", () => {
  it("範圍參數全無 → 400 點名 category / area / group", async () => {
    await expect400("/api/screen", "category / area / group 至少擇一");
  });

  it("多值參數只有逗號與空白 → 視同未給", async () => {
    await expect400("/api/screen?category=%20,%20,", "至少擇一");
  });

  it.each([
    ["minSharpePct=101", "minSharpePct", "0–100"],
    ["minSharpePct=-1", "minSharpePct", "0–100"],
    ["minSharpePct=abc", "minSharpePct", "0–100"],
    ["minDropPct=101", "minDropPct", "0–100"],
    ["minWins=6", "minWins", "0–5"],
    ["weakPct=150", "weakPct", "0–100"],
    ["maxRr=0", "maxRr", "1–5"],
    ["maxRr=9", "maxRr", "1–5"],
    ["limit=0", "limit", "1–500"],
    ["limit=501", "limit", "1–500"],
  ])("%s → 400 點名參數與範圍", async (qs, name, range) => {
    await expect400(`/api/screen?category=台灣股票&${qs}`, name, range);
  });

  it.each(["weakWindows=6m,2y", "weakWindows=", "weakWindows=,"])("%s → 400 點名允許值", async (qs) => {
    await expect400(`/api/screen?category=台灣股票&${qs}`, "weakWindows", "3m/6m/1y");
  });

  it.each(["minSharpePct=0", "minSharpePct=100", "minWins=0", "minWins=5", "maxRr=1", "maxRr=5", "limit=1", "limit=500"])(
    "邊界值 %s 接受",
    async (qs) => {
      await ok(`/api/screen?category=台灣股票&${qs}`);
    },
  );

  it("未給的參數沿用預設值", async () => {
    const body = await ok("/api/screen?category=台灣股票");
    expect(body.params).toEqual({ minSharpePct: 50, minDropPct: 40, minWins: 3, weakPct: 40, weakWindows: ["6m", "1y"] });
  });

  it("多值參數切分、去空白、濾空", async () => {
    const body = await ok("/api/screen?category=%20台灣股票%20,,%20日本股票&currency=TWD,%20&maxRr=3&weakWindows=%203m%20,,1y");
    expect(body.filters).toEqual({ categories: ["台灣股票", "日本股票"], currencies: ["TWD"], maxRr: 3 });
    expect(body.params.weakWindows).toEqual(["3m", "1y"]);
  });
});

describe("GET /api/funds — 請求驗證", () => {
  it.each([
    ["limit=abc", "limit"],
    ["limit=-1", "limit"],
    ["limit=2.5", "limit"],
    ["offset=-1", "offset"],
    ["offset=abc", "offset"],
    ["order=sideways", "order", "asc/desc"],
    ["minSharpe3y=abc", "minSharpe3y"],
    ["maxStd1y=abc", "maxStd1y"],
  ])("%s → 400 點名參數", async (qs, ...mentions) => {
    await expect400(`/api/funds?${qs}`, ...mentions);
  });

  it("預設 limit 50 / offset 0", async () => {
    const body = await ok("/api/funds");
    expect(body).toMatchObject({ count: 0, limit: 50, offset: 0, funds: [] });
  });

  it("limit 上限 500(超過則夾到 500,維持既有行為)", async () => {
    expect((await ok("/api/funds?limit=1000")).limit).toBe(500);
  });

  it("空值參數(GET / 端點範本的 minSharpe3y=&maxStd1y=&order=)視同未給", async () => {
    const queries: unknown[][] = [];
    const db = { prepare: (sql: string) => ({ ...stmt, bind: (...args: unknown[]) => (queries.push([sql, ...args]), stmt) }), batch: async () => [] };
    const res = await app.request("/api/funds?group=&minSharpe3y=&maxStd1y=&order=", {}, { DB: db as unknown as D1Database });
    expect(res.status).toBe(200);
    const [sql] = queries[0] as [string];
    expect(sql).not.toContain("sharpe_3y\" >=");
    expect(sql).not.toContain("std_1y\" <=");
    expect(sql).toMatch(/desc limit/i);
  });

  it.each(["order=asc", "order=desc", "order=ASC"])("%s 接受(不分大小寫)", async (qs) => {
    await ok(`/api/funds?${qs}`);
  });
});
