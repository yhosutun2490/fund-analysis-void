import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/services/ingest", () => ({
  runIngest: vi.fn().mockResolvedValue({ status: "ok" }),
}));

import { scheduled } from "../src/triggers/scheduled";
import { runIngest } from "../src/services/ingest";

const callScheduled = (ctx: ExecutionContext, env: object = {}) =>
  scheduled({} as ScheduledController, env as never, ctx);

describe("scheduled trigger", () => {
  it("把工作交給 runIngest 並透過 waitUntil 掛起", () => {
    const promises: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (p: Promise<unknown>) => promises.push(p),
    } as unknown as ExecutionContext;

    callScheduled(ctx);

    expect(runIngest).toHaveBeenCalledOnce();
    expect(promises).toHaveLength(1);
  });

  it("不向外丟出例外", () => {
    const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
    expect(() => callScheduled(ctx)).not.toThrow();
  });
});

describe("scheduled trigger — Discord 通知", () => {
  const WEBHOOK = "https://discord.test/api/webhooks/1/abc";
  const env = { DISCORD_WEBHOOK_URL: WEBHOOK };
  let posts: { url: string; content: string }[];

  // 跑一次 cron,等 waitUntil 掛起的工作結束
  async function runCron(e: object = env) {
    let pending: Promise<unknown> = Promise.resolve();
    callScheduled({ waitUntil: (p: Promise<unknown>) => (pending = p) } as unknown as ExecutionContext, e);
    await pending;
  }

  beforeEach(() => {
    posts = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      posts.push({ url, content: JSON.parse(init.body).content });
      return new Response(null, { status: 204 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ingest 失敗 → POST 一則含錯誤訊息的「失敗」通知", async () => {
    vi.mocked(runIngest).mockRejectedValueOnce(new Error("鉅亨 Search/Detail 回應格式不符: data.fundDatas[0].nav"));
    await runCron();
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe(WEBHOOK);
    expect(posts[0].content).toContain("🔴");
    expect(posts[0].content).toContain("失敗");
    expect(posts[0].content).toContain("回應格式不符: data.fundDatas[0].nav");
  });

  it("成功但帶 warning → POST 一則「warning」通知,含 dataTime / upserted / note", async () => {
    vi.mocked(runIngest).mockResolvedValueOnce({
      status: "ok", dataTime: "2026-10-22", dataCount: 4543, fetched: 4543, upserted: 4500,
      note: "鉅亨 Search/Detail 出現未知欄位（加性變動）: data.fundDatas[].brandNew",
    });
    await runCron();
    expect(posts).toHaveLength(1);
    const c = posts[0].content;
    expect(c).toContain("🟡");
    expect(c).not.toContain("🔴");
    expect(c).toContain("2026-10-22");
    expect(c).toContain("4500");
    expect(c).toContain("data.fundDatas[].brandNew");
  });

  it("乾淨成功 → 不 POST", async () => {
    vi.mocked(runIngest).mockResolvedValueOnce({
      status: "ok", dataTime: "2026-10-22", dataCount: 1, fetched: 1, upserted: 1, note: undefined,
    });
    await runCron();
    expect(posts).toHaveLength(0);
  });

  it("未設定 DISCORD_WEBHOOK_URL → 安靜略過,不 POST", async () => {
    vi.mocked(runIngest).mockRejectedValueOnce(new Error("boom"));
    await runCron({});
    expect(posts).toHaveLength(0);
  });

  it("webhook 本身失敗 → 不崩潰,ingest 結果不受影響", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("discord down");
    });
    vi.mocked(runIngest).mockRejectedValueOnce(new Error("boom"));
    await expect(runCron()).resolves.toBeUndefined();
    expect(runIngest).toHaveBeenCalled();
  });

  it("訊息截斷至 Discord 2000 字元上限", async () => {
    vi.mocked(runIngest).mockRejectedValueOnce(new Error("x".repeat(5000)));
    await runCron();
    expect(posts[0].content.length).toBeLessThanOrEqual(2000);
  });
});
