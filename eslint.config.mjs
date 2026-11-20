// @ts-check
// The lint config is @beaconsgg/eslint-config, installed from the npm registry: the base rules, the
// RN-safety gate and the tier gate, read from this repo's workspace and from `beacon.foreign` in
// package.json (the game packages the console installs, which only plugins.ts may import).
import { URL } from "node:url";
import { repoConfig } from "@beaconsgg/eslint-config";

export default repoConfig(new URL("./", import.meta.url));
