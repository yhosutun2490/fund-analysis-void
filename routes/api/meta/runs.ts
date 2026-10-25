// GET /api/meta/runs:ingest 執行紀錄。
import { defineHandler } from "void";
import { listRuns } from "../../../src/repositories/ingest";
import { endpoints } from "../../../src/schemas/endpoints";
import { responds } from "../../../src/lib/validation";

export const GET = responds(
  endpoints["GET /api/meta/runs"].responses,
  defineHandler(async (c) => c.json({ runs: await listRuns(c.env.DB) })),
);
