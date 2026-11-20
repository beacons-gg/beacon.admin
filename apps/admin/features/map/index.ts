// Public surface of the map feature.
export { MapCanvas } from "./MapCanvas";
export { PointPicker } from "./PointPicker";
export { InspectPanel, type Inspect } from "./InspectPanel";
export { useMapData } from "./useMapData";
export { getRoom, type RoomCard } from "./api";
export {
  toFeatureCollections,
  colorRooms,
  fillLegend,
  isShown,
  keepShown,
  originColor,
  MAP_KINDS,
  KIND_COLORS,
  NOTHING_HIDDEN,
  ROOM_GROUPS,
  type Facets,
  type MapHidden,
  type RoomGroup,
  type ServerMapData,
  type PointFeature,
  type FeatureCollection,
} from "./logic";
