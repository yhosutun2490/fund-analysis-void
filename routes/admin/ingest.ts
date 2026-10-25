// POST /admin/ingest:手動觸發抓取（與 cron 同一流程）。
import { defineHandler } from "void";
import { endpoints } from "../../src/schemas/endpoints";
import { runIngest } from "../../src/services/ingest";
import { responds } from "../../src/lib/validation";

export const POST = responds(
  endpoints["POST /admin/ingest"].responses,
  defineHandler(async (c) => {
    try {
      return c.json(await runIngest(c.env));
    } catch (e) {
      return c.json({ status: "error", message: e instanceof Error ? e.message : String(e) }, 500);
    }
  }),
);
