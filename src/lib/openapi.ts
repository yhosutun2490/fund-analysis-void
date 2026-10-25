// 從端點契約登錄表（src/schemas/endpoints.ts）產生 OpenAPI 3.1 文件。純函式,不碰 DB / env。
import { z } from "zod";
import { version } from "../../package.json";
import { DISCLAIMER } from "../schemas/shared";

/** 登錄表的一筆:一個端點的摘要與契約。responses 就是路由檔傳給 responds() 的那份。 */
export interface Endpoint {
  summary: string;
  /** 長說明:放 JSON Schema 表達不了的規則（如 schema 層級的 refine）。 */
  description?: string;
  tag: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  responses: Partial<Record<number, z.ZodType>>;
}

/**
 * 請求 schema → OpenAPI parameters。以 input 形狀轉換（使用者實際送的,如逗號分隔字串）;
 * transform 等表達不了的部分轉成不限型別,不讓產生失敗。required 取自 input 形狀的 JSON Schema。
 */
function parameters(slot: "path" | "query", schema: z.ZodObject | undefined) {
  if (!schema) return [];
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as {
    properties: Record<string, object>;
    required?: string[];
  };
  return Object.entries(json.properties).map(([name, s]) => ({
    name,
    in: slot,
    required: json.required?.includes(name) ?? false,
    schema: s,
  }));
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
    const [method, route] = key.split(" ");
    const path = route.replace(/:(\w+)/g, "{$1}");
    paths[path] ??= {};
    paths[path][method.toLowerCase()] = {
      summary: ep.summary,
      description: ep.description,
      tags: [ep.tag],
      parameters: [...parameters("path", ep.params), ...parameters("query", ep.query)],
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
