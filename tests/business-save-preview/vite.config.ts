import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "./api", replacement: resolve("tests/business-save-preview/api.ts") },
      { find: "../../i18n", replacement: resolve("src/i18n.tsx") }
    ]
  },
  build: {
    outDir: "tmp/business-save-preview-build",
    rollupOptions: { input: resolve("tests/business-save-preview/index.html") }
  },
  optimizeDeps: { entries: ["tests/business-save-preview/index.html"] },
  server: { host: "127.0.0.1", port: 5191, strictPort: true }
});
