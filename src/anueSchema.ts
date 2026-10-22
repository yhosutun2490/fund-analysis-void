// 鉅亨回應的 zod 驗證共用件。schema 只釘「結構與型別」;哨兵/null 的領域清理仍歸 normalize。
// 偵測靈敏度：已知欄位被移除/改型別/在必填處變 null → 硬失敗;多出未知欄位 → 只回報（不 .strict()）。
import { z } from "zod";
import { describeIssues } from "./zodIssues";

/** 鉅亨回應格式不符（契約變動）。與 HTTP / succ:false 等可用性錯誤分開,呼叫端據此分流。 */
export class AnueSchemaError extends Error {
  override name = "AnueSchemaError";
}

// 鉅亨目前會回、但我們不消費的欄位：不參與 pass/fail,只用來區分「加性變動」
const alsoKnown = new WeakMap<z.ZodObject, ReadonlySet<string>>();

/** 為 object schema 登記「已知但不消費」的欄位名（見 anueKnownKeys.ts 的實測快照）。 */
export function withKnownKeys<T extends z.ZodObject>(schema: T, keys: readonly string[]): T {
  alsoKnown.set(schema, new Set(keys));
  return schema;
}

/** 走訪 schema 與原始值,收集兩者皆未宣告的欄位路徑（陣列元素以 [] 合併,避免逐列重複）。 */
function collectUnknownKeys(schema: z.ZodType, value: unknown, path: string, out: Set<string>): void {
  if (value == null) return;
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    collectUnknownKeys(schema.unwrap() as z.ZodType, value, path, out);
  } else if (schema instanceof z.ZodArray) {
    if (Array.isArray(value)) for (const v of value) collectUnknownKeys(schema.element as z.ZodType, v, `${path}[]`, out);
  } else if (schema instanceof z.ZodObject && typeof value === "object") {
    const shape = schema.shape as Record<string, z.ZodType>;
    const extra = alsoKnown.get(schema);
    for (const [k, v] of Object.entries(value)) {
      const p = path ? `${path}.${k}` : k;
      if (k in shape) collectUnknownKeys(shape[k], v, p, out);
      else if (!extra?.has(k)) out.add(p);
    }
  }
}

/** 以 schema 驗證鉅亨回應;不符 → AnueSchemaError（點名路徑）,未知欄位 → 回傳於 unknownKeys。 */
export function parseAnue<S extends z.ZodType>(
  schema: S,
  json: unknown,
  endpoint: string,
): { body: z.output<S>; unknownKeys: string[] } {
  const r = schema.safeParse(json);
  if (!r.success) throw new AnueSchemaError(`鉅亨 ${endpoint} 回應格式不符: ${describeIssues(r.error)}`);
  const out = new Set<string>();
  collectUnknownKeys(schema, json, "", out);
  return { body: r.data, unknownKeys: [...out] };
}

/** 鉅亨各端點共用的外層信封;各回應 schema 以 .extend() 補上自己消費的欄位。 */
export const AnueEnvelope = z.object({ succ: z.boolean(), code: z.string(), message: z.string().nullish() });

/**
 * 先驗外層信封:succ:false 照舊丟一般上游錯誤（非格式問題）;succ:true 再以完整 schema 驗證。
 * 成功時 data 為必填,故「succ:true 但 data 變 null」屬格式不符。
 */
export function parseAnueResponse<S extends z.ZodType>(schema: S, json: unknown, endpoint: string) {
  const env = parseAnue(AnueEnvelope, json, endpoint).body;
  if (!env.succ) throw new Error(`Anue code ${env.code}: ${env.message ?? ""}`);
  return parseAnue(schema, json, endpoint);
}

/** 加性變動的 warning 文字（記進 ingest_runs.note / log）。 */
export const unknownKeysWarning = (endpoint: string, keys: string[]) =>
  `鉅亨 ${endpoint} 出現未知欄位（加性變動）: ${keys.join(", ")}`;
