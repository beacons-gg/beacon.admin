#!/usr/bin/env node
/**
 * Adds a deployment's game plugins to this console build: installs each package into the console
 * and rewrites `plugins.ts` to list them (apps/admin/README.md, "Game plugins").
 *
 *   node apps/admin/scripts/add-plugins.mjs @example/beacon-admin-plugin@^1.2.0 [more...]
 *
 * Each argument is a package name, `@<game>/beacon-admin-plugin`, with an optional version range;
 * none is nothing to do. It changes `package.json`, the lockfile and `plugins.ts`, so run it on a
 * checkout you build from, never one you commit from.
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(APP_DIR, "../..");

/** A console plugin's package name, which the lint and the Tailwind `@source` glob also key on. */
const PLUGIN_NAME = /^@[a-z0-9][a-z0-9._-]*\/beacon-admin-plugin$/;

/**
 * The package name in an install spec: `@scope/name@range` is `@scope/name`. Throws on a name that
 * is not a console plugin's.
 *
 * @param {string} spec
 */
export function pluginName(spec) {
  const at = spec.indexOf("@", 1);
  const name = at === -1 ? spec : spec.slice(0, at);
  if (!PLUGIN_NAME.test(name)) {
    throw new Error(`${spec}: a console plugin is the package @<game>/beacon-admin-plugin`);
  }
  return name;
}

/**
 * The `plugins.ts` that lists these plugin packages, in this order. The repository's copy is this
 * with none, and a test holds the two to the same template.
 *
 * @param {readonly string[]} names
 */
export function renderPluginList(names) {
  const imports = names.map((name, i) => `import * as plugin${i} from "${name}";\n`).join("");
  const entries = names.map((name, i) => `  { name: "${name}", exports: plugin${i} },\n`).join("");
  return `// The game plugin packages this console build carries, and the one file in the console that may
// import one. The repository lists none; scripts/add-plugins.mjs writes it (README, "Game plugins").
import type { PluginPackage } from "@/features/games/plugins";
${imports}
export const PLUGIN_PACKAGES: readonly PluginPackage[] = [${entries ? `\n${entries}` : ""}];
`;
}

function main() {
  const specs = process.argv.slice(2);
  const names = specs.map(pluginName);
  if (names.length === 0) return;
  execFileSync("pnpm", ["--filter", "@beaconsgg/admin", "add", ...specs], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  // A plugin that brings its own copy of the contract would find no host at runtime.
  execFileSync(process.execPath, [resolve(REPO_ROOT, "scripts/check-contract-copies.mjs")], {
    stdio: "inherit",
  });
  // Where `app/globals.css` sources plugin classes from: missing, the screens would render unstyled.
  for (const name of names) {
    const dist = resolve(APP_DIR, "node_modules", name, "dist");
    if (!existsSync(dist)) throw new Error(`${name}: no built screens at ${dist}`);
  }
  writeFileSync(resolve(APP_DIR, "plugins.ts"), renderPluginList(names));
  console.log(`ok   plugins.ts lists ${names.join(", ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
