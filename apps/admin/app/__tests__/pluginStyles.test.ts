import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_PACKAGES } from "@/plugins";
import { pluginName } from "../../scripts/add-plugins.mjs";

/**
 * Tailwind scans only this app's files, so a game plugin's classes reach the built CSS through one
 * `@source` glob over the plugin package name, the name the lint also keys on
 * (`@<game>/beacon-admin-plugin`). Without the line, with a plugin named otherwise, or with the glob
 * pointing where the installed copy is not, the build still passes and the plugin's screens render
 * unstyled; this is what says so. The repository lists no plugin, so the per-plugin checks hold for
 * the plugins a deployment adds (`scripts/add-plugins.mjs`), and a glob that matches nothing builds.
 */
// Paths, not `new URL(x, import.meta.url)`: Vite rewrites that form into a served asset URL.
const CSS = resolve(__dirname, "../globals.css");
const read = (path: string) => readFileSync(path, "utf8");
const plugins = PLUGIN_PACKAGES.map((p) => p.name);

/** The one `@source` line for plugins, as written: its glob, relative to the stylesheet. */
const pluginSource = () => {
  const m = read(CSS).match(/@source "([^"]*beacon-admin-plugin[^"]*)";/);
  if (!m) throw new Error("globals.css has no @source line for the console plugins");
  return m[1]!;
};

describe("game plugin styles", () => {
  it("globals.css sources every console plugin's built classes by the plugin name", () => {
    expect(pluginSource()).toMatch(/\/@\*\/beacon-admin-plugin\/dist$/);
  });

  it("every game plugins.ts lists is a package the glob covers", () => {
    for (const name of plugins) expect(pluginName(name)).toBe(name);
  });

  it("the glob's directory is where this app's scoped packages install", () => {
    // Holds with no plugin listed: the repository lists none, so this is what keeps the glob honest
    // for the plugins a deployment adds. A scoped package this app depends on lands where a plugin
    // would.
    const glob = resolve(dirname(CSS), pluginSource());
    const scoped = glob.replace(
      "@*/beacon-admin-plugin/dist",
      "@beaconsgg/client-sdk/package.json",
    );
    expect(existsSync(scoped), `${scoped} should be @beaconsgg/client-sdk's manifest`).toBe(true);
  });

  it("the glob resolves to each listed plugin's installed dist", () => {
    // Installed from the registry, so where it lands is the package manager's layout, not ours: a
    // layout change would move it out from under the glob and leave the screens unstyled.
    for (const name of plugins) {
      const dir = resolve(dirname(CSS), pluginSource().replace("@*/beacon-admin-plugin", name));
      expect(existsSync(dir), `${dir} should hold ${name}'s built screens`).toBe(true);
    }
  });
});
