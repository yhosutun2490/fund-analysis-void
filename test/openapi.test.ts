import { describe, expect, it } from "vitest";
import { z } from "zod";
import { request, routeEndpoints } from "./entry";
import { toOpenAPI } from "../src/lib/openapi";
import { DISCLAIMER } from "../src/schemas/shared";
import pkg from "../package.json";

// GET /openapi.json:由端點契約登錄表產生的 OpenAPI 3.1 文件。
async function openapi() {
  const res = await request("/openapi.json");
  expect(res.status).toBe(200);
  return (await res.json()) as {
    openapi: string;
    info: { title: string; version: string; description: string };
    paths: Record<string, Record<string, Operation>>;
    components: { securitySchemes: Record<string, Record<string, string>> };
  };
}

type Parameter = { name: string; in: "path" | "query"; required: boolean; schema: Record<string, any>; description?: string };
type Operation = {
  description?: string;
  requestBody?: { required: boolean; content: Record<string, { schema: Record<string, any> }> };
  parameters?: Parameter[];
  security?: Record<string, string[]>[];
  responses: Record<string, JsonResponse>;
};
const param = (op: Operation, name: string) => op.parameters?.find((p) => p.name === name);

type JsonResponse = { content: { "application/json": { schema: Record<string, any> } } };
const schemaOf = (r: JsonResponse) => r.content["application/json"].schema;

describe("GET /", () => {
  it("是載入 /openapi.json 的 Swagger UI 頁面", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("swagger-ui-dist@");
    expect(html).toContain('url: "/openapi.json"');
  });
});

describe("GET /openapi.json", () => {
  it("文件列的端點與 routes/ 的路由檔(方法 + 路徑)一一對應,文件端點本身除外", async () => {
    const { paths } = await openapi();
    const documented = Object.entries(paths)
      .flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`))
      .sort();
    const files = routeEndpoints(import.meta.glob("../routes/**/*.ts", { eager: true }))
      .filter((e) => e !== "GET /" && e !== "GET /openapi.json")
      .sort();
    expect(documented).toEqual(files);
  });

  it("是 OpenAPI 3.1 文件,列出 meta 端點", async () => {
    const doc = await openapi();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths["/api/meta/categories"])).toEqual(["get"]);
    expect(Object.keys(doc.paths["/api/meta/runs"])).toEqual(["get"]);
  });

  it("info 帶服務名稱、package 版本、定位與免責聲明全文", async () => {
    const { info } = await openapi();
    expect(info.title).toBe("fund-risks-analysis");
    expect(info.version).toBe(pkg.version);
    expect(info.description).toContain("private/internal tool");
    expect(info.description).toContain(DISCLAIMER);
  });

  it("回應依狀態碼列出 JSON schema:literal → const,strictObject → additionalProperties false", async () => {
    const { responses } = (await openapi()).paths["/admin/ingest"].post;
    const ok = schemaOf(responses["200"]);
    expect(ok.properties.status).toEqual({ type: "string", const: "ok" });
    expect(ok.additionalProperties).toBe(false);
    expect(ok.required).toEqual(["status", "dataTime", "dataCount", "fetched", "upserted"]);
    expect(schemaOf(responses["500"]).properties.status.const).toBe("error");
  });

  it.each(["/admin/ingest", "/admin/ingest/challenge"])(
    "POST %s 需要登入:security 引用 session cookie scheme,401/403 回 { error }",
    async (path) => {
      const op = (await openapi()).paths[path].post;
      expect(op.security).toEqual([{ sessionCookie: [] }]);
      for (const status of ["401", "403"]) {
        const schema = schemaOf(op.responses[status]);
        expect(schema.required).toEqual(["error"]);
        expect(schema.additionalProperties).toBe(false);
      }
    },
  );

  it("POST /admin/ingest/challenge:沒有 requestBody,202 回 { status: sent, expiresAt, resendAfter }", async () => {
    const op = (await openapi()).paths["/admin/ingest/challenge"].post;
    expect(op).not.toHaveProperty("requestBody");
    expect(Object.keys(op.responses)).toEqual(["202", "401", "403", "429", "502"]);
    const sent = schemaOf(op.responses["202"]);
    expect(sent.properties.status.const).toBe("sent");
    expect(sent.properties.expiresAt).toMatchObject({ type: "string", format: "date-time" });
    expect(sent.properties.resendAfter).toMatchObject({ type: "string", format: "date-time" });
    expect(sent.required).toEqual(["status", "expiresAt", "resendAfter"]);
    expect(sent.additionalProperties).toBe(false);
  });

  it("POST /admin/ingest/challenge:429 resend_too_soon 帶 retryAfter 秒數", async () => {
    const { responses } = (await openapi()).paths["/admin/ingest/challenge"].post;
    const tooSoon = schemaOf(responses["429"]);
    expect(tooSoon.properties.error.const).toBe("resend_too_soon");
    expect(tooSoon.properties.retryAfter).toMatchObject({ type: "integer", exclusiveMinimum: 0 });
    expect(tooSoon.required).toEqual(["error", "retryAfter"]);
    expect(tooSoon.additionalProperties).toBe(false);
  });

  it("POST /admin/ingest/challenge:502 寄信失敗回 { error: email_send_failed }", async () => {
    const { responses } = (await openapi()).paths["/admin/ingest/challenge"].post;
    const failed = schemaOf(responses["502"]);
    expect(failed.properties.error.const).toBe("email_send_failed");
    expect(failed.required).toEqual(["error"]);
    expect(failed.additionalProperties).toBe(false);
  });

  it("POST /admin/ingest:requestBody 為 6 位數 code;列出 200/400/401/403/422/500", async () => {
    const op = (await openapi()).paths["/admin/ingest"].post;
    expect(op.requestBody!.required).toBe(true);
    const body = op.requestBody!.content["application/json"].schema;
    expect(body.required).toEqual(["code"]);
    expect(body.properties.code).toMatchObject({ type: "string", pattern: "^\\d{6}$" });

    expect(Object.keys(op.responses)).toEqual(["200", "400", "401", "403", "422", "500"]);
    // 400:欄位驗證失敗,或 body 不是 JSON
    const bad = schemaOf(op.responses["400"]).anyOf.map((s: Record<string, any>) => s.properties.error.const);
    expect(bad).toEqual(["Validation failed", "Invalid JSON body"]);
    // 422:碼不符(帶剩餘次數),或沒有有效的驗證碼
    const [mismatch, invalid] = schemaOf(op.responses["422"]).anyOf;
    expect(mismatch.properties.error.const).toBe("code_mismatch");
    expect(mismatch.properties.attemptsLeft).toMatchObject({ type: "integer", minimum: 0 });
    expect(mismatch.required).toEqual(["error", "attemptsLeft"]);
    expect(mismatch.additionalProperties).toBe(false);
    expect(invalid.properties.error.const).toBe("challenge_invalid");
  });

  it("components.securitySchemes 宣告 Better Auth session cookie 的 apiKey scheme", async () => {
    const { components } = await openapi();
    expect(components.securitySchemes.sessionCookie).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "better-auth.session_token",
    });
  });

  it("公開端點沒有 security,文件也沒有全域 security", async () => {
    const doc = await openapi();
    expect(doc).not.toHaveProperty("security");
    const secured = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.entries(ops)
        .filter(([, op]) => op.security)
        .map(([m]) => `${m.toUpperCase()} ${path}`),
    );
    expect(secured).toEqual(["POST /admin/ingest/challenge", "POST /admin/ingest"]);
  });

  it("動態段寫成 {id};recovery 列出 200/400/404/502,disclaimer 為 const", async () => {
    const { responses } = (await openapi()).paths["/api/funds/{id}/recovery"].get;
    expect(Object.keys(responses)).toEqual(["200", "400", "404", "502"]);
    expect(schemaOf(responses["200"]).properties.disclaimer.const).toBe(DISCLAIMER);
    expect(schemaOf(responses["200"]).properties.basis.const).toBe("total_return");
    const v400 = schemaOf(responses["400"]);
    expect(v400.properties.error.const).toBe("Validation failed");
    expect(v400.properties.issues.items.properties.slot.enum).toEqual(["query", "params", "body"]);
    expect(schemaOf(responses["404"]).properties.error.type).toBe("string");
  });

  it("path 與 query 參數:型別、範圍、預設值、是否必填由 zod schema 推出", async () => {
    const op = (await openapi()).paths["/api/funds/{id}/recovery"].get;
    expect(param(op, "id")).toMatchObject({ in: "path", required: true, schema: { type: "string", minLength: 1 } });
    expect(param(op, "minDepth")).toMatchObject({
      in: "query",
      required: false,
      schema: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 100, default: 10 },
    });
    expect(param(op, "from")).toMatchObject({ in: "query", required: false, schema: { type: "string" } });
    expect(op.parameters!.map((p) => p.name)).toEqual(["id", "from", "to", "minDepth", "refresh"]);
  });

  it("/api/funds 系列:空值視同未給的參數仍呈現實際型別,各端點列出自己的狀態碼", async () => {
    const { paths } = await openapi();
    const list = paths["/api/funds"].get;
    expect(param(list, "minSharpe3y")).toMatchObject({ required: false, schema: { type: "number" } });
    expect(param(list, "maxStd1y")).toMatchObject({ required: false, schema: { type: "number" } });
    expect(param(list, "order")).toMatchObject({ required: false, schema: { enum: ["asc", "desc"], default: "desc" } });
    expect(param(list, "limit")).toMatchObject({ required: false, schema: { type: "integer", minimum: 0, default: 50 } });
    expect(Object.keys(list.responses)).toEqual(["200", "400"]);
    expect(schemaOf(list.responses["200"]).properties.disclaimer.const).toBe(DISCLAIMER);
    expect(Object.keys(paths["/api/funds/{id}"].get.responses)).toEqual(["200", "400", "404"]);
    expect(Object.keys(paths["/api/funds/{id}/history"].get.responses)).toEqual(["200", "400"]);
    expect(param(paths["/api/funds/{id}/history"].get, "id")).toMatchObject({ in: "path", required: true });
  });

  it("參數帶說明與範例;schema 層級規則寫進端點說明", async () => {
    const { paths } = await openapi();
    const list = paths["/api/funds"].get;
    expect(param(list, "sort")!.schema.examples).toEqual(["sharpe_3y"]);
    expect(param(list, "limit")!.schema.description).toContain("500");
    const recovery = paths["/api/funds/{id}/recovery"].get;
    expect(recovery.description).toContain("from 不可晚於 to");
    expect(param(recovery, "refresh")!.schema).toMatchObject({ type: "string", examples: ["false"] });
    expect(param(recovery, "refresh")!.schema.description).toBeTruthy();
    expect(param(recovery, "from")!.schema.examples).toEqual(["2020-01-01"]);
  });

  it("/api/screen 列出 200/400,basis 與 disclaimer 為 const", async () => {
    const { responses } = (await openapi()).paths["/api/screen"].get;
    expect(Object.keys(responses)).toEqual(["200", "400"]);
    expect(schemaOf(responses["200"]).properties.basis.const).toBe("anue_year_fields_unverified");
    expect(schemaOf(responses["200"]).properties.disclaimer.const).toBe(DISCLAIMER);
  });

  it("/api/screen 參數以使用者實際送的形狀呈現:逗號分隔字串、數值範圍與預設值", async () => {
    const op = (await openapi()).paths["/api/screen"].get;
    expect(op.description).toContain("category / area / group 至少擇一");

    const category = param(op, "category")!;
    expect(category).toMatchObject({ required: false, schema: { type: "string", examples: ["台灣股票"] } });
    expect(category.schema.description).toContain("逗號分隔");

    const weakWindows = param(op, "weakWindows")!;
    expect(weakWindows).toMatchObject({ required: false, schema: { type: "string", default: "6m,1y" } });
    expect(weakWindows.schema.description).toContain("3m/6m/1y");

    expect(param(op, "minSharpePct")!.schema).toMatchObject({ type: "number", minimum: 0, maximum: 100, default: 50 });
    expect(param(op, "maxRr")).toMatchObject({ required: false, schema: { type: "number", minimum: 1, maximum: 5 } });
    expect(param(op, "limit")!.schema).toMatchObject({ minimum: 1, maximum: 500, default: 100 });
  });
});

// 產生器本身:以測試用登錄項目驗證 request body 的轉換規則（input 形狀、transform 退化）。
describe("toOpenAPI", () => {
  const ok = z.strictObject({ status: z.literal("ok") });
  type WithBody = { requestBody: { required: boolean; content: Record<string, { schema: Record<string, any> }> } };

  it("有 body 的登錄項目輸出 requestBody:application/json、必填,以 input 形狀轉換", () => {
    const doc = toOpenAPI({
      "POST /test/body": {
        summary: "測試用",
        tag: "test",
        body: z.strictObject({
          code: z.string().regex(/^\d{6}$/).describe("6 位數驗證碼"),
          count: z.string().transform(Number).optional(),
        }),
        responses: { 200: ok },
      },
    });
    const { requestBody } = doc.paths["/test/body"].post as WithBody;
    expect(requestBody.required).toBe(true);
    expect(Object.keys(requestBody.content)).toEqual(["application/json"]);
    const schema = requestBody.content["application/json"].schema;
    expect(schema.$schema).toBeUndefined();
    expect(schema).toMatchObject({ type: "object", required: ["code"], additionalProperties: false });
    expect(schema.properties.code).toMatchObject({ type: "string", pattern: "^\\d{6}$", description: "6 位數驗證碼" });
    expect(schema.properties.count).toEqual({ type: "string" });
  });

  it("沒有 body 的登錄項目不輸出 requestBody", () => {
    const doc = toOpenAPI({ "GET /test/plain": { summary: "測試用", tag: "test", responses: { 200: ok } } });
    expect(doc.paths["/test/plain"].get).not.toHaveProperty("requestBody");
  });
});
