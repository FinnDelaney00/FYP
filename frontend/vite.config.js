import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "jsdom",
    clearMocks: true,
    pool: "threads",
    restoreMocks: true,
  },
});
