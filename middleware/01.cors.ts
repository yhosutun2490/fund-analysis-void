import { cors } from "hono/cors";
import { defineMiddleware } from "void";

const apiCors = cors();

/**
 * /api/* 的 CORS(含 OPTIONS preflight)。放在全域 middleware,路由檔不必各自處理;
 * preflight 不需要路由檔 export OPTIONS,cors() 會直接回 204。
 */
export default defineMiddleware((c, next) => (c.req.path.startsWith("/api/") ? apiCors(c, next) : next()));
