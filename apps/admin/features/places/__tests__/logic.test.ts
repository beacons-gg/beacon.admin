import type { Media } from "@beaconsgg/protocol-types";
import { describe, expect, it } from "vitest";
import { categoryLabel, mediaUrl, parseCells, parseGeohashPrefixes, placeImages } from "../logic";
import { toBase64 } from "../photo";

describe("places input parsing (wire-schema validated)", () => {
  it("parseCells: trims, lowercases, and drops non-geohash tokens", () => {
    expect(parseCells(" C23nb , c23nc ,, ")).toEqual(["c23nb", "c23nc"]);
    expect(parseCells("aioli")).toEqual([]); // a/i/l/o are outside the geohash charset
    expect(parseCells("")).toEqual([]);
  });

  /** Junk is REPORTED, not dropped — a dropped typo would widen an import to the whole volume. */
  it("parseGeohashPrefixes: normalizes, dedupes, and names what it refused", () => {
    expect(parseGeohashPrefixes(" 9Q5, 9q4c 9q5 ")).toEqual({
      prefixes: ["9q5", "9q4c"],
      invalid: [],
    });
    expect(parseGeohashPrefixes("9q5, aioli")).toEqual({ prefixes: ["9q5"], invalid: ["aioli"] });
    expect(parseGeohashPrefixes("")).toEqual({ prefixes: [], invalid: [] });
  });
});

describe("place media resolution", () => {
  it("mediaUrl: <hash>@host → the host's media route, scheme-on-read (LAN → http)", () => {
    expect(mediaUrl("abc123@places.example.com")).toBe("https://places.example.com/media/abc123");
    expect(mediaUrl("abc123@192.168.10.10:3001")).toBe("http://192.168.10.10:3001/media/abc123");
    expect(mediaUrl("no-host")).toBeUndefined();
    expect(mediaUrl("trailing@")).toBeUndefined();
    expect(mediaUrl("multi@at@host")).toBeUndefined(); // parseGlobalId strictness rides along
  });

  it("placeImages: pairs thumb+full by index, folds the credit, skips non-images", () => {
    const media: Media[] = [
      {
        type: "image",
        role: "thumb",
        hash: "t1",
        uris: ["t1@h.example.com"],
        credit: { author: "Jane Doe", license: "CC BY-SA 4.0" },
      },
      { type: "image", role: "full", hash: "f1", uris: ["f1@h.example.com"] },
      { type: "sound", hash: "s1", uris: ["s1@h.example.com"] },
    ];
    expect(placeImages(media)).toEqual([
      {
        thumb: "https://h.example.com/media/t1",
        full: "https://h.example.com/media/f1",
        credit: "Jane Doe · CC BY-SA 4.0",
      },
    ]);
    // A thumb with no full sibling links to itself; no media at all → no images.
    expect(placeImages([media[0]!])[0]!.full).toBe("https://h.example.com/media/t1");
    expect(placeImages(undefined)).toEqual([]);
    // Role-absent ⇒ "the sole/full asset" (the wire schema's semantics): rendered directly.
    expect(placeImages([{ type: "image", hash: "x", uris: ["x@h.example.com"] }])).toEqual([
      { thumb: "https://h.example.com/media/x", full: "https://h.example.com/media/x" },
    ]);
  });
});

// `mediaPairs` itself now lives in `@beaconsgg/protocol-types` (three consumers need the rule, and it
// must not fork) — its tests moved with it, to `protocol-types/src/__tests__/protocol-types.test.ts`.
// `placeImages` above still exercises it through this console's own rendering.

describe("categoryLabel", () => {
  it("joins category · subcategory, suppressing a slug that adds nothing", () => {
    expect(categoryLabel({ category: "nature", subcategory: "water" })).toBe("nature · water");
    expect(categoryLabel({ category: "park", subcategory: "park" })).toBe("park");
    expect(categoryLabel({ category: "culture" })).toBe("culture");
  });
});

describe("photo byte encodings", () => {
  it("toBase64 emits the standard padded alphabet (the upload body encoding)", () => {
    expect(toBase64(new Uint8Array([251, 239, 190]))).toBe("++++"); // '+'/'/' boundary chars
    expect(toBase64(new Uint8Array([104, 105]))).toBe("aGk=");
    // The content id beside it is @beaconsgg/identity's sha256Base64url, so there is no local hash to test.
  });
});
