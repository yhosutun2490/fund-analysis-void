// /api/meta 的回應契約。列形狀由 select 子句衍生（rowOf,見 src/db/selections.ts）。
import { z } from "zod";
import { categoryCols, rowOf, runCols } from "../db/selections";

/** GET /api/meta/categories。 */
export const CategoriesResponse = z.strictObject({
  categories: z.array(rowOf(categoryCols).extend({ n: z.number().int().nonnegative() })),
});

/** GET /api/meta/runs。 */
export const RunsResponse = z.strictObject({ runs: z.array(rowOf(runCols)) });
