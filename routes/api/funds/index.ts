// GET /api/funds:基金清單 + 篩選 + 排序（以最新快照）。
import { defineHandler } from "void";
import { listFunds } from "../../../src/repositories/funds";
import { endpoints } from "../../../src/schemas/endpoints";
import { DISCLAIMER } from "../../../src/schemas/shared";
import { responds } from "../../../src/lib/validation";

const endpoint = endpoints["GET /api/funds"];

export const GET = responds(
  endpoint.responses,
  defineHandler.withValidator({ query: endpoint.query })(async (c, { query }) => {
    const { order, limit, offset, ...q } = query;
    const results = await listFunds(c.env.DB, { ...q, order: order === "asc" ? "ASC" : "DESC", limit, offset });
    return c.json({ count: results.length, limit, offset, disclaimer: DISCLAIMER, funds: results });
  }),
);
