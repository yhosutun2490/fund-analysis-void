// Vite 於建置時替換的旗標（vite build → PROD=true;vite dev / vitest → false）。
interface ImportMetaEnv {
  readonly PROD: boolean;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
