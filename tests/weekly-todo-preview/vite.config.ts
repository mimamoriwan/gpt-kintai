import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({ plugins: [react()], resolve: { alias: [{ find: "./api", replacement: resolve("tests/weekly-todo-preview/api.ts") }, { find: "../services/api", replacement: resolve("tests/weekly-todo-preview/reportApi.ts") }, { find: "../auth", replacement: resolve("tests/weekly-todo-preview/auth.ts") }] }, optimizeDeps: { entries: ["tests/weekly-todo-preview/index.html"] }, server: { host: "127.0.0.1", port: 5211, strictPort: true } });
