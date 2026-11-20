// Public surface of the places feature.
export { PlacesPanel } from "./PlacesPanel";
export { getPlace, queryPlaces, uploadPlacePhoto } from "./api"; // reads other features consume (the map) + the browser photo→media pipeline (challenge rewards ride it too)
export { placeImages, type PlaceImage } from "./logic"; // resolved place photos (the map inspect)
export { ImageStrip } from "./ImageStrip"; // the linked thumbnail strip both panels render
export { PlaceDescriptor } from "./PlaceDescriptor"; // description + outbound website link pair
