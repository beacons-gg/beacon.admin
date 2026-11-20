// Public surface of the games feature: the host the console gives its game plugins. The plugins
// themselves are `./plugins`, imported directly by the shell and Explore, which have no use for the
// host and its map.
export { PluginHost } from "./host";
