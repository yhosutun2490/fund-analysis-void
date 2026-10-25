import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/ingest", () => ({ runIngest: vi.fn() }));

import { request, signedInAs } from "./entry";
import { ErrorResponse } from "../src/schemas/shared";
import { runIngest } from "../src/services/ingest";

const ingest = { method: "POST" };
const okRun = { status: "ok", dataTime: "2026-10-22", dataCount: 1, fetched: 1, upserted: 1, note: undefined } as const;

describe("/admin/* 守門(全域 middleware)", () => {
  beforeEach(() => {
    vi.mocked(runIngest).mockReset();
  });

  it("未登入 POST /admin/ingest → 401 { error },不執行抓取", async () => {
    const res = await request("/admin/ingest", ingest, { ADMIN_EMAILS: "admin@example.com" });
    expect(res.status).toBe(401);
    expect(ErrorResponse.parse(await res.json())).toEqual({ error: "unauthorized" });
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("守門作用於 /admin 本身與任何 /admin/* 路徑(之後新增的 admin 路由預設受保護)", async () => {
    for (const path of ["/admin", "/admin/not-yet-a-route"]) {
      expect((await request(path)).status).toBe(401);
    }
    // 只比對路徑段,/administrator 之類不受影響
    expect((await request("/administrator")).status).toBe(404);
  });

  it("已登入但 email 不在 ADMIN_EMAILS → 403 { error }", async () => {
    const res = await request("/admin/ingest", ingest, { ADMIN_EMAILS: "admin@example.com" }, signedInAs("guest@example.com"));
    expect(res.status).toBe(403);
    expect(ErrorResponse.parse(await res.json())).toEqual({ error: "forbidden" });
    expect(runIngest).not.toHaveBeenCalled();
  });

  it("已登入的管理員 → 放行,照常執行抓取", async () => {
    vi.mocked(runIngest).mockResolvedValue(okRun);
    const res = await request("/admin/ingest", ingest, { ADMIN_EMAILS: "admin@example.com" }, signedInAs("admin@example.com"));
    expect(res.status).toBe(200);
    expect(runIngest).toHaveBeenCalledOnce();
  });

  it("email 大小寫不同、清單項目前後有空白 → 仍是管理員", async () => {
    vi.mocked(runIngest).mockResolvedValue(okRun);
    const env = { ADMIN_EMAILS: " other@example.com ,  Admin@Example.COM  " };
    const res = await request("/admin/ingest", ingest, env, signedInAs("aDMIN@example.com"));
    expect(res.status).toBe(200);
  });

  it.each([
    ["未設定", {}],
    ["空字串", { ADMIN_EMAILS: "" }],
    ["只有逗號與空白", { ADMIN_EMAILS: " , " }],
  ])("ADMIN_EMAILS %s → 已登入也是 403(fail-closed)", async (_, env) => {
    const res = await request("/admin/ingest", ingest, env, signedInAs("admin@example.com"));
    expect(res.status).toBe(403);
    ErrorResponse.parse(await res.json());
    expect(runIngest).not.toHaveBeenCalled();
  });
});
