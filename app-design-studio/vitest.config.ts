import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // jsdom matches the sanitizer's runtime (DOMPurify + DOMParser), so unit
    // tests exercise the same normalization the canvas applies.
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
