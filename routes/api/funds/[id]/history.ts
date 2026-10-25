// GET /api/funds/:id/history:單檔風險歷史（cron 累積出來的月序列）。
import { defineHandler } from "void";
import { getRiskHistory } from "../../../../src/repositories/funds";
import { FundHistoryResponse, FundIdParam } from "../../../../src/schemas/funds";
import { DISCLAIMER, ValidationErrorResponse } from "../../../../src/schemas/shared";
import { responds } from "../../../../src/lib/validation";

export const GET = responds(
  { 200: FundHistoryResponse, 400: ValidationErrorResponse },
  defineHandler.withValidator({ params: FundIdParam })(async (c, { params }) => {
    const history = await getRiskHistory(c.env.DB, params.id);
    return c.json({ fund_id: params.id, count: history.length, history, disclaimer: DISCLAIMER });
  }),
);
