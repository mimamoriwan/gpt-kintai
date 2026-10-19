import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: [
    { find: "../services/accountManagement", replacement: resolve("tests/account-preview/service.ts") },
    { find: "../auth", replacement: resolve("tests/account-preview/auth.ts") }
  ] },
  optimizeDeps: { entries: ["tests/account-preview/index.html"] },
  server: { host: "127.0.0.1", port: 5187, strictPort: true }
});
