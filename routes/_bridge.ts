import { defineHandler } from "void";
import { app } from "../src/app";

/**
 * 過渡用轉接:把尚未遷移成原生路由檔的請求(routes/api/[...slug].ts)交給既有的 Hono app。
 * 那些端點的路由仍由 src/app.ts 定義;已遷移的端點各有自己的路由檔。
 * 檔名以 _ 開頭,Void 不會把它當成路由。
 */
export const forward = defineHandler((c) => app.fetch(c.req.raw, c.env, c.executionCtx));
