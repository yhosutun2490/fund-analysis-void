import { Hono } from "hono";
import type { Env } from "../env";
import { runIngest } from "../services/ingest";

export const admin = new Hono<{ Bindings: Env }>();

// 手動觸發抓取（與 cron 同一流程）
admin.post("/ingest", async (c) => {
  try {
    const result = await runIngest(c.env);
    return c.json(result);
  } catch (e) {
    return c.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
