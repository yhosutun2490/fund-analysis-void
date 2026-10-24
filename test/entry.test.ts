import { describe, expect, it } from "vitest";
import { createEntry } from "./entry";

// 測試入口本身的掛載規則(依 Void 檔名規則),用假的路由表驗證。
const text = (body: string) => () => new Response(body);

describe("測試用路由入口", () => {
  it("具體路由檔優先於 catch-all(不論 glob 順序)", async () => {
    const app = createEntry({
      "../routes/api/[...slug].ts": { GET: text("catch-all") },
      "../routes/api/funds/index.ts": { GET: text("funds") },
    });
    expect(await (await app.request("/api/funds")).text()).toBe("funds");
    expect(await (await app.request("/api/other/x")).text()).toBe("catch-all");
  });

  it("[x] 轉成路徑參數、index 對應目錄、_ 開頭的檔案不掛", async () => {
    const app = createEntry({
      "../routes/index.ts": { GET: text("root") },
      "../routes/api/funds/[id]/history.ts": { GET: (c) => ({ id: c.req.param("id") }) },
      "../routes/_bridge.ts": { GET: text("bridge") },
    });
    expect(await (await app.request("/")).text()).toBe("root");
    expect(await (await app.request("/api/funds/A1/history")).json()).toEqual({ id: "A1" });
    expect((await app.request("/_bridge")).status).toBe(404);
  });

  it("全域 middleware 依數字前綴排序、先於路由執行", async () => {
    const order: string[] = [];
    const app = createEntry(
      { "../routes/index.ts": { GET: () => (order.push("route"), "ok") } },
      {
        "../middleware/02.second.ts": { default: async (_c, next) => (order.push("02"), next()) },
        "../middleware/01.first.ts": { default: async (_c, next) => (order.push("01"), next()) },
      },
    );
    await app.request("/");
    expect(order).toEqual(["01", "02", "route"]);
  });
});
