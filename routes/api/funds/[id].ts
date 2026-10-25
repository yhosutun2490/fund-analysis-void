// GET /api/funds/:id:單檔基本資料 + 最新快照。
import { defineHandler } from "void";
import { getFund, getLatestRisk } from "../../../src/repositories/funds";
import { FundDetailResponse, FundIdParam } from "../../../src/schemas/funds";
import { DISCLAIMER, ErrorResponse, ValidationErrorResponse } from "../../../src/schemas/shared";
import { responds } from "../../../src/lib/validation";

export const GET = responds(
  { 200: FundDetailResponse, 400: ValidationErrorResponse, 404: ErrorResponse },
  defineHandler.withValidator({ params: FundIdParam })(async (c, { params }) => {
    const fund = await getFund(c.env.DB, params.id);
    if (!fund) return c.json({ error: "not found" }, 404);
    const latest = await getLatestRisk(c.env.DB, params.id);
    return c.json({ fund, latest_risk: latest, disclaimer: DISCLAIMER });
  }),
);
