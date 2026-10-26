import { cors } from "hono/cors";
import { defineMiddleware } from "void";

const apiCors = cors();

/**
 * Void auth 端點(`/api/auth`、`/api/auth/*`)不套萬用 CORS,其他網域的頁面讀不到它的回應。
 * Void 把 auth handler 掛在使用者 middleware 之後,不排除就會被這裡一起包住。
 */
const isAuthPath = (path: string) => path === "/api/auth" || path.startsWith("/api/auth/");

/**
 * /api/* 的 CORS(含 OPTIONS preflight)。放在全域 middleware,路由檔不必各自處理;
 * preflight 不需要路由檔 export OPTIONS,cors() 會直接回 204。
 */
export default defineMiddleware((c, next) =>
  c.req.path.startsWith("/api/") && !isAuthPath(c.req.path) ? apiCors(c, next) : next(),
);
