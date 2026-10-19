import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      includeAssets: ["favicon.svg", "pwa-192.png", "pwa-512.png", "apple-touch-icon.png"],
      manifest: {
        name: "GyoumuLog 勤怠・業務記録",
        short_name: "GyoumuLog",
        description: "勤怠と業務日報を簡単に記録する社内システム",
        theme_color: "#155eef",
        background_color: "#f5f7fb",
        display: "standalone",
        start_url: "/",
        lang: "ja",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" }
        ]
      },
      injectManifest: { globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"] }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "react";
          if (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase")) return "firebase";
          if (id.includes("node_modules/lucide-react")) return "icons";
        }
      }
    }
  }
});
