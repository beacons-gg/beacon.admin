import { defineConfig } from "vitest/config";
import { SRC_SCOPE, coverageFor } from "@beaconsgg/vitest-config";

// JSX under the automatic runtime, so a `.test.tsx` needs no `import React`.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { coverage: coverageFor({ include: SRC_SCOPE }) },
});
