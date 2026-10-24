import { defineHandler } from "void";
import { app } from "../src/app";

/**
 * 過渡用轉接:把沒有對應原生路由檔的 /api 請求(routes/api/[...slug].ts)交給既有的 Hono app。
 * 所有端點都已有自己的路由檔,src/app.ts 已不掛路由,這裡只會回 404;待移除。
 * 檔名以 _ 開頭,Void 不會把它當成路由。
 */
export const forward = defineHandler((c) => app.fetch(c.req.raw, c.env, c.executionCtx));
