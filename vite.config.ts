import { defineConfig } from "vite";
import { voidPlugin } from "void";

export default defineConfig({
  plugins: [voidPlugin()],
  // Vite dev 內建的 cors 中介層會在請求進到 Worker 前直接回 OPTIONS 204
  // (只放行 localhost origin),讓 src/app.ts 的 cors() 收不到 preflight。
  // 關掉後 preflight 走 routes/api/[...slug].ts 的 OPTIONS → Hono。
  server: { cors: false },
});
