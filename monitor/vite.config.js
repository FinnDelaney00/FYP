import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    clearMocks: true,
    pool: "threads",
    restoreMocks: true,
    coverage: {
      all: true,
      exclude: ["src/**/__tests__/**"],
      include: ["src/**/*.js"],
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
