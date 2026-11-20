// Public surface of the media feature (cross-feature imports go through here only).
// `removeMedia` is the one media wire seam moderation also calls, and `OwnerLabel` is how the map and
// the members screen name a player; everything else (list/review/useProfile/useMediaList) is internal
// to the feature and imported relatively.
export { MediaBrowser, OwnerLabel } from "./MediaBrowser";
export { removeMedia } from "./api";
