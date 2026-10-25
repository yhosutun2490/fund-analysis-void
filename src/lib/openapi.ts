// 從端點契約登錄表（src/schemas/endpoints.ts）產生 OpenAPI 3.1 文件。純函式,不碰 DB / env。
import { z } from "zod";
import { version } from "../../package.json";
import { DISCLAIMER } from "../schemas/shared";

/** 登錄表的一筆:一個端點的摘要與契約。responses 就是路由檔傳給 responds() 的那份。 */
export interface Endpoint {
  summary: string;
  tag: string;
  responses: Partial<Record<number, z.ZodType>>;
}

/** zod schema → OpenAPI 的 JSON 回應（JSON Schema 2020-12,即 OpenAPI 3.1 的方言;去掉 $schema）。 */
function jsonResponse(status: string, schema: z.ZodType) {
  const { $schema, ...json } = z.toJSONSchema(schema);
  return { description: status, content: { "application/json": { schema: json } } };
}

/** 登錄表的 key 形如 `GET /api/funds/:id`。 */
export function toOpenAPI(endpoints: Record<string, Endpoint>) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [key, ep] of Object.entries(endpoints)) {
    const [method, path] = key.split(" ");
    paths[path] ??= {};
    paths[path][method.toLowerCase()] = {
      summary: ep.summary,
      tags: [ep.tag],
      responses: Object.fromEntries(Object.entries(ep.responses).map(([status, schema]) => [status, jsonResponse(status, schema!)])),
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "fund-risks-analysis",
      version,
      description: `自用/內部基金風險分析工具（private/internal tool）,資料來源為鉅亨買基金。\n\n${DISCLAIMER}`,
    },
    paths,
  };
}
