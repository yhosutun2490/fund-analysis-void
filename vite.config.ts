import { defineConfig } from "vite";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [voidPlugin()],
  // Vite dev 內建的 cors 中介層會在請求進到 Worker 前直接回 OPTIONS 204
  // (只放行 localhost origin),讓我們的 cors() 收不到 preflight。
  // 關掉後 preflight 進到 Worker,由全域 middleware/01.cors.ts 回應(路由檔不需 export OPTIONS)。
  server: { cors: false },
});
