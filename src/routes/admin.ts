import { Hono } from "hono";
import type { Env } from "../bindings";
import { AdminIngestError, AdminIngestOk } from "../schemas/admin";
import { runIngest } from "../services/ingest";
import { responds } from "../validation";

export const admin = new Hono<{ Bindings: Env }>();

// 手動觸發抓取（與 cron 同一流程）
admin.post("/ingest", responds({ 200: AdminIngestOk, 500: AdminIngestError }), async (c) => {
  try {
    const result = await runIngest(c.env);
    return c.json(result);
  } catch (e) {
    return c.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
