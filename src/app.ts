import { Hono } from "hono";
import type { Env } from "./bindings";

// 過渡用:所有端點都已是 routes/ 底下的原生路由檔,這個 app 已不掛任何路由,收尾時連同 bridge 一起移除。
const app = new Hono<{ Bindings: Env }>();

export type AppType = typeof app;
export { app };
