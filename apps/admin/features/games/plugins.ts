import type { GamePlugin, RoomTypeName } from "@beaconsgg/admin-plugin";
import { gameSlugSchema } from "@beaconsgg/protocol-types";
import { PLUGIN_PACKAGES } from "@/plugins";

/** A plugin package, as `plugins.ts` lists it: its name, and everything it exports. */
export interface PluginPackage {
  name: string;
  exports: object;
}

/** What a `GamePlugin` looks like at runtime: a package's other exports are helpers and constants. */
function isGamePlugin(value: unknown): value is GamePlugin {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof GamePlugin, unknown>>;
  return (
    typeof candidate.slug === "string" &&
    typeof candidate.label === "string" &&
    candidate.icon != null &&
    candidate.Screen != null
  );
}

/**
 * The one plugin a package exports, whatever it calls it (one plugin under two names is still one).
 * A package with none or several fails the build here by name, rather than leaving its game out of
 * the console.
 */
export function pluginIn({ name, exports }: PluginPackage): GamePlugin {
  const found = [...new Set(Object.values(exports).filter(isGamePlugin))];
  if (found.length !== 1) {
    throw new Error(`${name} should export one GamePlugin, and exports ${found.length}`);
  }
  return found[0]!;
}

/**
 * The plugins in these packages, checked where the build would otherwise pass and the page break:
 * each slug is a game slug, since the console signs the plugin's writes as it, and no two plugins
 * share one, since the slug is the plugin's route.
 */
export function pluginsIn(packages: readonly PluginPackage[]): GamePlugin[] {
  const slugs = new Set<string>();
  return packages.map((pkg) => {
    const plugin = pluginIn(pkg);
    if (!gameSlugSchema.safeParse(plugin.slug).success) {
      throw new Error(
        `${pkg.name}: the plugin's slug ${JSON.stringify(plugin.slug)} is not a game slug`,
      );
    }
    if (slugs.has(plugin.slug)) {
      throw new Error(`${pkg.name}: another plugin already has the slug ${plugin.slug}`);
    }
    slugs.add(plugin.slug);
    return plugin;
  });
}

/**
 * The game plugins this console build carries. Each is rendered under `/games/<slug>` inside the
 * console's host and listed in the nav's Games group. A console with none builds and has neither.
 */
export const GAME_PLUGINS: readonly GamePlugin[] = pluginsIn(PLUGIN_PACKAGES);

/** The plugin at `/games/<slug>`, or undefined. */
export function pluginFor(slug: string): GamePlugin | undefined {
  return GAME_PLUGINS.find((plugin) => plugin.slug === slug);
}

/** A colour the map can draw: MapLibre reads hex, not every CSS colour. */
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The plugins' names for their games' room types, by game: a plugin that names none adds nothing. A
 * colour that is not six-digit hex is dropped with a warning, and the type gets a palette colour.
 */
export function roomTypeLabelsOf(
  plugins: readonly GamePlugin[],
): ReadonlyMap<string, Readonly<Record<string, RoomTypeName>>> {
  return new Map(
    plugins.flatMap((plugin) => {
      if (!plugin.roomTypes) return [];
      const names = Object.entries(plugin.roomTypes).map(([type, { label, color }]) => {
        if (color === undefined || HEX_COLOR.test(color)) return [type, { label, color }] as const;
        console.warn(`${plugin.slug}: room type ${type} colour ${color} is not #rrggbb; ignored`);
        return [type, { label }] as const;
      });
      return [[plugin.slug, Object.fromEntries(names)] as const];
    }),
  );
}

/** What Explore names room types by; it falls back to the raw type where no plugin names one. */
export const ROOM_TYPE_LABELS = roomTypeLabelsOf(GAME_PLUGINS);
