import { defineConfig } from "vitest/config"

// Unit tests cover pure modules, so they run in Node without the Cloudflare
// plugin (and without booting the Worker) that vite.config.ts adds.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
