// GET /api/meta/runs:ingest 執行紀錄。
import { defineHandler } from "void";
import { listRuns } from "../../../src/repositories/ingest";
import { RunsResponse } from "../../../src/schemas/meta";
import { responds } from "../../../src/validation";

export const GET = responds(
  { 200: RunsResponse },
  defineHandler(async (c) => c.json({ runs: await listRuns(c.env.DB) })),
);
