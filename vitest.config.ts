import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Mirror tsconfig's `@/* -> ./src/*` path mapping so runtime (non-type) `@/`
  // imports resolve in tests. Without this, only `import type` `@/` imports work
  // (they're erased at transform); a value import like `@/lib/design` fails.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
