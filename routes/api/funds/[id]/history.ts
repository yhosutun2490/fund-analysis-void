// GET /api/funds/:id/history:單檔風險歷史（cron 累積出來的月序列）。
import { defineHandler } from "void";
import { getRiskHistory } from "../../../../src/repositories/funds";
import { endpoints } from "../../../../src/schemas/endpoints";
import { DISCLAIMER } from "../../../../src/schemas/shared";
import { responds } from "../../../../src/lib/validation";

const endpoint = endpoints["GET /api/funds/:id/history"];

export const GET = responds(
  endpoint.responses,
  defineHandler.withValidator({ params: endpoint.params })(async (c, { params }) => {
    const history = await getRiskHistory(c.env.DB, params.id);
    return c.json({ fund_id: params.id, count: history.length, history, disclaimer: DISCLAIMER });
  }),
);
