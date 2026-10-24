/// <reference types="vite/client" />
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { convertReturnValue } from "void/response";
import type { Env } from "../src/bindings";

/**
 * 測試用路由入口:Void 沒有提供測試用的 app 建構器,這裡用 import.meta.glob
 * 讀進 routes/ 底下的路由檔,依 Void 的檔名規則轉成路徑掛到一個 Hono 實例上。
 *
 * 規則對照 Void 的 router(node_modules/void 的 parseRouteFilename / compareRouteSpecificity):
 * - `index` → 所在目錄;`[x]` → `:x`;`(group)` 目錄不進路徑
 * - 任一段以 `_` 開頭的檔案不是路由
 * - 同一段靜態優先於動態
 *
 * 已知限制:比對順序由這裡自己實作,不是 Void 實際的 router。只要沒有 catch-all 跟動態段競爭就不會有差異,
 * 所以不支援 catch-all(`[...x]`)路由檔:遇到就直接報錯,要用時再照 Void 的 compareRouteSpecificity 補上。
 */

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
type Method = (typeof METHODS)[number];
type RouteHandler = (c: Context<{ Bindings: Env }>) => unknown;
export type RouteModule = Partial<Record<Method, RouteHandler>>;
export type MiddlewareModule = { default: MiddlewareHandler<{ Bindings: Env }> };

interface Route {
  pattern: string;
  module: RouteModule;
}

/** glob key(如 `../routes/api/funds/[id].ts`)→ 路由;不是路由檔則回 null。 */
function toRoute(key: string, module: RouteModule): Route | null {
  const rel = key.replace(/^.*?\/routes\//, "").replace(/\.(ts|mts|js|mjs)$/, "");
  const segments = rel.split("/");
  if (segments.some((s) => s.startsWith("_"))) return null;
  if (segments[segments.length - 1] === "index") segments.pop();
  const parts = segments
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
    .map((s) => {
      if (s.startsWith("[...")) throw new Error(`測試入口不支援 catch-all 路由檔:${key}`);
      if (s.startsWith("[") && s.endsWith("]")) return `:${s.slice(1, -1)}`;
      return s;
    });
  return { pattern: "/" + parts.join("/"), module };
}

function bySpecificity(a: Route, b: Route): number {
  const as = a.pattern.split("/");
  const bs = b.pattern.split("/");
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const aDyn = as[i].startsWith(":");
    const bDyn = bs[i].startsWith(":");
    if (aDyn !== bDyn) return aDyn ? 1 : -1;
    if (as[i] !== bs[i]) return as[i].localeCompare(bs[i]);
  }
  return as.length - bs.length;
}

/** middleware 檔名的數字前綴決定順序(`01.cors.ts`);沒有前綴排最後。 */
const middlewareOrder = (key: string) => {
  const match = key.split("/").pop()!.match(/^(\d+)\./);
  return match ? parseInt(match[1], 10) : Infinity;
};

/** glob 結果 → 依比對優先順序排好的路由表。 */
const routeTable = (routes: Record<string, RouteModule>) =>
  Object.entries(routes)
    .map(([key, module]) => toRoute(key, module))
    .filter((r): r is Route => r !== null)
    .sort(bySpecificity);

/** 路由檔(glob 結果)實際提供的端點,形如 `GET /api/funds/:id`。 */
export const routeEndpoints = (routes: Record<string, RouteModule>) =>
  routeTable(routes).flatMap(({ pattern, module }) => METHODS.filter((m) => module[m]).map((m) => `${m} ${pattern}`));

/** 依 Void 檔名規則把路由表與全域 middleware(皆為 glob 結果)掛成一個 Hono app。 */
export function createEntry(
  routes: Record<string, RouteModule>,
  middleware: Record<string, MiddlewareModule> = {},
) {
  const app = new Hono<{ Bindings: Env }>();
  Object.entries(middleware)
    .filter(([key]) => !key.replace(/^.*?\/middleware\//, "").startsWith("_"))
    .sort(([a], [b]) => middlewareOrder(a) - middlewareOrder(b))
    .forEach(([, mod]) => app.use(mod.default));
  for (const { pattern, module } of routeTable(routes)) {
    for (const method of METHODS) {
      const handler = module[method];
      if (handler) app.on(method, pattern, async (c) => convertReturnValue(await handler(c)));
    }
  }
  return app;
}

const entry = createEntry(
  import.meta.glob<RouteModule>("../routes/**/*.ts", { eager: true }),
  import.meta.glob<MiddlewareModule>("../middleware/**/*.ts", { eager: true }),
);

// 路由檔可能用 c.executionCtx(例如 waitUntil);測試環境沒有 Worker,給一個空殼。
const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
  props: {},
} as unknown as ExecutionContext;

/** 對整個 app(路由檔 + 全域 middleware)送出請求。 */
export const request = (path: string, init?: RequestInit, env?: Partial<Env>) =>
  entry.request(path, init, env, executionCtx);
