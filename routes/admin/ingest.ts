// POST /admin/ingest:手動觸發抓取（與 cron 同一流程）。
import { defineHandler } from "void";
import { AdminIngestError, AdminIngestOk } from "../../src/schemas/admin";
import { runIngest } from "../../src/services/ingest";
import { responds } from "../../src/validation";

export const POST = defineHandler(responds({ 200: AdminIngestOk, 500: AdminIngestError }), async (c) => {
  try {
    return c.json(await runIngest(c.env));
  } catch (e) {
    return c.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
