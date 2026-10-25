import { describe, expect, it } from "vitest";
import { request, routeEndpoints } from "./entry";

// GET / 的 endpoints 清單是手寫的(不從 route map 產生),這裡鎖住它跟 routes/ 底下的路由檔一致。
describe("GET / 的 endpoints 清單", () => {
  it("與 routes/ 實際的路由檔(方法 + 路徑)一一對應", async () => {
    const { endpoints } = (await (await request("/")).json()) as { endpoints: string[] };
    // 清單項目形如 "GET  /api/funds?group=&...":去掉 query 範例、壓縮空白後只比方法與路徑
    const listed = endpoints.map((e) => e.split("?")[0].replace(/\s+/g, " ").trim()).sort();
    // 清單描述的是 GET / 以外的端點,不列自己
    const files = routeEndpoints(import.meta.glob("../routes/**/*.ts", { eager: true }))
      .filter((e) => e !== "GET /")
      .sort();
    expect(listed).toEqual(files);
  });
});
