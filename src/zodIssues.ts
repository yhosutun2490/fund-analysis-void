import type { z } from "zod";

const pathOf = (path: PropertyKey[]) =>
  path.reduce<string>((s, k) => (typeof k === "number" ? `${s}[${k}]` : s ? `${s}.${String(k)}` : String(k)), "");

/** zod issues → 單行訊息（路徑: 原因）;同一錯誤可能逐列上千處,只列前 3 處並附總數。 */
export function describeIssues(error: z.ZodError): string {
  const shown = error.issues.slice(0, 3).map((i) => `${pathOf(i.path) || "(root)"}: ${i.message}`);
  const more = error.issues.length > 3 ? `（共 ${error.issues.length} 處）` : "";
  return shown.join("; ") + more;
}
