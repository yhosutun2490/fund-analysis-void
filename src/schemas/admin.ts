// POST /admin/ingest 的回應契約。
import { z } from "zod";

export const AdminIngestOk = z.strictObject({
  status: z.literal("ok"),
  dataTime: z.string(),
  dataCount: z.number().int().nonnegative(),
  fetched: z.number().int().nonnegative(),
  upserted: z.number().int().nonnegative(),
  note: z.string().optional(),
});

export const AdminIngestError = z.strictObject({ status: z.literal("error"), message: z.string() });
