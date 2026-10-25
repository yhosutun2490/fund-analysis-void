// 型別層級的測試(由 npm run typecheck 檢查,不是 vitest 測試檔):
// typed fetch(void/routes 的 RouteMap)讀 `typeof import(路由檔)[方法]["__validators"]` 推導輸入型別。
// responds() 包住 handler 之後,validator 推導出的 query/params 型別必須還在。
import type { GET as FundDetail } from "../routes/api/funds/[id]";
import type { GET as FundHistory } from "../routes/api/funds/[id]/history";
import type { GET as Recovery } from "../routes/api/funds/[id]/recovery";
import type { GET as FundList } from "../routes/api/funds/index";
import type { GET as Screen } from "../routes/api/screen/index";
import type { FundIdParam, FundListQuery, RecoveryQuery } from "../src/schemas/funds";
import type { ScreenQuery } from "../src/schemas/screen";

type Expect<T extends true> = T;
type Carries<H extends { __validators: unknown }, V> = H["__validators"] extends V ? true : false;

export type Checks = [
  Expect<Carries<typeof Screen, { query: typeof ScreenQuery }>>,
  Expect<Carries<typeof FundList, { query: typeof FundListQuery }>>,
  Expect<Carries<typeof FundDetail, { params: typeof FundIdParam }>>,
  Expect<Carries<typeof FundHistory, { params: typeof FundIdParam }>>,
  Expect<Carries<typeof Recovery, { params: typeof FundIdParam; query: typeof RecoveryQuery }>>,
];
