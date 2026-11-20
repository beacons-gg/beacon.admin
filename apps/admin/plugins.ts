// The game plugin packages this console build carries, and the one file in the console that may
// import one. The repository lists none; scripts/add-plugins.mjs writes it (README, "Game plugins").
import type { PluginPackage } from "@/features/games/plugins";

export const PLUGIN_PACKAGES: readonly PluginPackage[] = [];
