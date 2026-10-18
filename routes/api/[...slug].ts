import { forward } from "../_bridge";

export const GET = forward;
// CORS preflight 交給 src/app.ts 的 cors() 回應(需搭配 vite.config.ts 的 server.cors: false)
export const OPTIONS = forward;
