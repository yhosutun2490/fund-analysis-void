// GET /api/funds/:id:單檔基本資料 + 最新快照。
import { defineHandler } from "void";
import { getFund, getLatestRisk } from "../../../src/repositories/funds";
import { endpoints } from "../../../src/schemas/endpoints";
import { DISCLAIMER } from "../../../src/schemas/shared";
import { responds } from "../../../src/lib/validation";

const endpoint = endpoints["GET /api/funds/:id"];

export const GET = responds(
  endpoint.responses,
  defineHandler.withValidator({ params: endpoint.params })(async (c, { params }) => {
    const fund = await getFund(c.env.DB, params.id);
    if (!fund) return c.json({ error: "not found" }, 404);
    const latest = await getLatestRisk(c.env.DB, params.id);
    return c.json({ fund, latest_risk: latest, disclaimer: DISCLAIMER });
  }),
);
