import { describe, expect, it } from "vitest";
import { request } from "./entry";
import { DISCLAIMER } from "../src/schemas/shared";
import pkg from "../package.json";

// GET /openapi.json:由端點契約登錄表產生的 OpenAPI 3.1 文件。
async function openapi() {
  const res = await request("/openapi.json");
  expect(res.status).toBe(200);
  return (await res.json()) as {
    openapi: string;
    info: { title: string; version: string; description: string };
    paths: Record<string, Record<string, { responses: Record<string, JsonResponse> }>>;
  };
}

type JsonResponse = { content: { "application/json": { schema: Record<string, any> } } };
const schemaOf = (r: JsonResponse) => r.content["application/json"].schema;

describe("GET /openapi.json", () => {
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
    expect(Object.keys(responses)).toEqual(["200", "500"]);
    const ok = schemaOf(responses["200"]);
    expect(ok.properties.status).toEqual({ type: "string", const: "ok" });
    expect(ok.additionalProperties).toBe(false);
    expect(ok.required).toEqual(["status", "dataTime", "dataCount", "fetched", "upserted"]);
    expect(schemaOf(responses["500"]).properties.status.const).toBe("error");
  });
});
