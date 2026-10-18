import { defineHandler } from "void";
import { app } from "../src/app";

/**
 * 過渡用轉接:把 Void 的檔案路由整包交給既有的 Hono app。
 * 路由仍由 src/app.ts 定義,Void 只負責建置、部署與 binding。
 * 檔名以 _ 開頭,Void 不會把它當成路由。
 */
export const forward = defineHandler((c) => app.fetch(c.req.raw, c.env, c.executionCtx));
