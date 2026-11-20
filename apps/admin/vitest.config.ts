import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { coverageFor } from "@beaconsgg/vitest-config";

/**
 * Where a Next app keeps its sources: not `src/`, which is why this is the one workspace that does
 * not inherit the shared scope. Spelled once because the test glob and the coverage scope are both
 * derived from it, and they were two lists that had already drifted: the glob reached `features/`
 * and `lib/` while the scope covered all five, so a suite under `app/`, `components/` or `hooks/`
 * would have been collected by nothing and passed by never running: a silent green that the first
 * suite under `components/shell` would have walked straight into. Two lists cannot drift when there
 * is one.
 */
const SOURCES = ["app", "components", "features", "hooks", "lib"];

export default defineConfig({
  resolve: {
    // Mirror tsconfig's `@/*` path alias (Next resolves it at build; vitest needs it here).
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  /*
   * `tsconfig.json` says `jsx: "preserve"`, which is what Next wants and what esbuild would
   * otherwise inherit: it would hand vitest a module still holding JSX. The app builds under the
   * automatic runtime, so the suites do too, and a `.test.tsx` needs no `import React`.
   */
  esbuild: { jsx: "automatic" },
  test: {
    include: [`{${SOURCES.join(",")}}/**/__tests__/**/*.test.ts?(x)`],
    /*
     * A DOM for every file, not only the `.tsx` ones. Every module in a Next app is browser code,
     * and `environment: "node"` was a statement about what this suite could reach rather than about
     * the app. The 123 logic tests that predate the change pass under it unmodified, WebCrypto
     * included: vitest keeps node's `crypto`, where jsdom's own has no `subtle`.
     */
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Everything a human wrote is in scope. Subtracted is the shadcn output nobody has touched
    // since the CLI wrote it: the `components/ui` primitives, and the `use-mobile` hook that ships
    // with the sidebar block. `lib/utils.ts` arrived the same way but has been added to by hand, so
    // it stays in scope. Still far under the repo floor at 21.9%, so it carries its own.
    // What is left is the rest of the console's rendered half, panel by panel: the settings screen
    // is covered and the other twelve are not, so this number climbs a panel at a time, and the
    // floor with it.
    coverage: coverageFor({
      include: SOURCES.map((dir) => `${dir}/**`),
      exclude: ["components/ui/**", "hooks/use-mobile.ts"],
      floor: 21,
    }),
  },
});
