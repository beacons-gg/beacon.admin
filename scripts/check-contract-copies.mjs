#!/usr/bin/env node
/**
 * Gate: one copy of `@beaconsgg/admin-plugin` in the install.
 *
 * The console provides `AdminHostContext` from the workspace copy of the contract. A game's plugin,
 * installed from the registry, names the contract as a peer dependency, so pnpm resolves it to the
 * console's copy and the plugin's `useAdminHost()` reads the context the console provides. If a
 * second copy appears (a plugin that names the contract as a plain dependency, or a range the
 * workspace version no longer satisfies), pnpm fetches it from the registry, and the plugin reads a
 * context nobody provides. Nothing else catches that: the console builds, the suites pass, and the
 * plugin's screen finds no host at runtime.
 *
 * pnpm's isolated layout keeps every fetched package under `node_modules/.pnpm` as
 * `<name with / as +>@<version>…`; a workspace package is linked from `packages/` and leaves no
 * such entry. So the check is that no entry for the contract exists there.
 */
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT = "@beaconsgg/admin-plugin";
const store = join(repoRoot, "node_modules", ".pnpm");

if (!existsSync(store)) {
  console.error(`${store} does not exist: run pnpm install first`);
  process.exit(2);
}

const copies = readdirSync(store).filter((entry) =>
  entry.startsWith(`${CONTRACT.replace("/", "+")}@`),
);
if (copies.length > 0) {
  console.error(
    `FAIL a registry copy of ${CONTRACT} is installed beside the workspace one:\n` +
      copies.map((c) => `  node_modules/.pnpm/${c}`).join("\n") +
      "\nA plugin's `useAdminHost()` would read a context the console never provides. Check which " +
      "installed plugin names the contract as a dependency rather than a peer, or at a range the " +
      `workspace version does not satisfy (pnpm why ${CONTRACT}).`,
  );
  process.exit(1);
}
console.log(`ok   one copy of ${CONTRACT}: the workspace package`);
