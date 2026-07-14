import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/firestore.rules.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000
  }
});
