import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { GamePlugin } from "@beaconsgg/admin-plugin";
import { pluginIn, pluginsIn, roomTypeLabelsOf } from "@/features/games/plugins";
import { PLUGIN_PACKAGES } from "@/plugins";
import { pluginName, renderPluginList } from "../../../scripts/add-plugins.mjs";

const plugin = (slug: string, roomTypes?: GamePlugin["roomTypes"]): GamePlugin => ({
  slug,
  label: slug,
  icon: () => null,
  Screen: () => null,
  ...(roomTypes ? { roomTypes } : {}),
});

describe("the plugins this build carries", () => {
  const pkg = (game: string, exports: object) => ({
    name: `@${game}/beacon-admin-plugin`,
    exports,
  });

  it("fail the build on a slug that is not a game slug, or one two plugins share", () => {
    // The console signs the plugin's writes as its slug, and routes to it: caught when the build
    // loads the list, rather than as a render-time throw from `createClient` or a page that shows
    // the other plugin.
    const a = pkg("game-a", { plugin: plugin("game-a") });
    expect(pluginsIn([a, pkg("game-b", { plugin: plugin("game-b") })])).toHaveLength(2);
    expect(() => pluginsIn([pkg("game-a", { plugin: plugin("Game A") })])).toThrow(
      '@game-a/beacon-admin-plugin: the plugin\'s slug "Game A" is not a game slug',
    );
    expect(() => pluginsIn([a, pkg("game-b", { plugin: plugin("game-a") })])).toThrow(
      "@game-b/beacon-admin-plugin: another plugin already has the slug game-a",
    );
  });

  it("lend Explore their room type names, keyed by game, and only those that name any", () => {
    const named = { jar: { label: "Jar", color: "#0ea371" as const } };
    const labels = roomTypeLabelsOf([plugin("game-a", named), plugin("game-b")]);
    expect([...labels.keys()]).toEqual(["game-a"]);
    expect(labels.get("game-a")).toEqual(named);
  });

  it("drop a room type colour the map could not draw, with a warning, and keep its label", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const labels = roomTypeLabelsOf([
      plugin("game-a", { jar: { label: "Jar", color: "#0ea37" as `#${string}` } }),
    ]);
    expect(labels.get("game-a")).toEqual({ jar: { label: "Jar" } });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe("a plugin package", () => {
  const name = "@game-a/beacon-admin-plugin";

  it("gives the console the one plugin it exports, whatever the export is called", () => {
    const gameA = plugin("game-a");
    expect(pluginIn({ name, exports: { gameAPlugin: gameA, VERSION: "1.0.0", helper() {} } })).toBe(
      gameA,
    );
    // ...including under two names, as a default export beside a named one.
    expect(pluginIn({ name, exports: { default: gameA, gameAPlugin: gameA } })).toBe(gameA);
  });

  it("that exports no plugin, or several, fails the build by name", () => {
    expect(() => pluginIn({ name, exports: { VERSION: "1.0.0" } })).toThrow(
      `${name} should export one GamePlugin, and exports 0`,
    );
    const two = { a: plugin("game-a"), b: plugin("game-b") };
    expect(() => pluginIn({ name, exports: two })).toThrow("exports 2");
  });
});

describe("the plugin list a deployment writes", () => {
  const PLUGINS_TS = resolve(__dirname, "../../../plugins.ts");

  it("is plugins.ts as the script writes it, for the packages it lists", () => {
    // The repository's copy lists none; a build that added plugins wrote its own. Either way the
    // file is the script's template, so a hand edit that drifts from it is caught here.
    expect(renderPluginList(PLUGIN_PACKAGES.map((p) => p.name))).toBe(
      readFileSync(PLUGINS_TS, "utf8"),
    );
  });

  it("imports each package and lists it by name, in the order given", () => {
    const source = renderPluginList(["@game-a/beacon-admin-plugin", "@game-b/beacon-admin-plugin"]);
    expect(source).toContain('import * as plugin0 from "@game-a/beacon-admin-plugin";');
    expect(source).toContain('{ name: "@game-b/beacon-admin-plugin", exports: plugin1 },');
  });

  it("takes a package name with or without a version range, and only a console plugin's", () => {
    expect(pluginName("@game-a/beacon-admin-plugin")).toBe("@game-a/beacon-admin-plugin");
    expect(pluginName("@game-a/beacon-admin-plugin@^1.2.0")).toBe("@game-a/beacon-admin-plugin");
    for (const other of ["lodash", "@game-a/game", "@game-a/beacon-admin-plugin-extra"]) {
      expect(() => pluginName(other), other).toThrow("@<game>/beacon-admin-plugin");
    }
  });
});
