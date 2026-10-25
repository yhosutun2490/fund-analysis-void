import { defineConfig } from "vite";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [voidPlugin()],
  // Vite dev 內建的 cors 中介層會在請求進到 Worker 前直接回 OPTIONS 204
  // (只放行 localhost origin),preflight 根本到不了 Worker。
  // 關掉後 /api/* 的 OPTIONS preflight 才會進到 Worker,先經過 Void 全域 middleware/01.cors.ts,
  // 由其中的 Hono cors() 直接回 204,不會走到路由檔(路由檔不需 export OPTIONS)。正式環境本來就是這條路徑。
  server: { cors: false },
});
