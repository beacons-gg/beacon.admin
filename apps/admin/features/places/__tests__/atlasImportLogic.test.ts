import {
  placeAtlasImportParamsSchema,
  type PlaceAtlasSurveyBucket,
  type PlaceAtlasSurveyResult,
  type PlaceAtlasSurveyVariant,
} from "@beaconsgg/protocol-types";
import { describe, expect, it } from "vitest";
import {
  NO_CONTENT_FILTERS,
  NO_SUBCATEGORY,
  buildImportOptions,
  buildImportParams,
  describeImportOptions,
  describeSkipped,
  describeSwitches,
  switchHint,
  switchState,
  type AtlasSwitchInput,
  estimateImport,
  formatBytes,
  resolveAtlasTarget,
  selectAllTypes,
  tallyBuckets,
  toggleCategory,
  toggleSubcategory,
  typeRowsFromPreview,
  typeRowsFromSurvey,
  wireTypes,
  type AtlasTypeRow,
} from "../atlasImportLogic";

const PUBLISHER = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";

/** A variant; `flags` is photos/name/description as three letters, upper case meaning "has". */
const v = (flags: string, places: number, photoFiles = 0): PlaceAtlasSurveyVariant => ({
  hasPhotos: flags[0] === "P",
  hasName: flags[1] === "N",
  hasDescription: flags[2] === "D",
  places,
  photoFiles,
});
const bucket = (
  category: string,
  subcategory: string | undefined,
  variants: PlaceAtlasSurveyVariant[],
  supported = true,
): PlaceAtlasSurveyBucket => ({
  category,
  ...(subcategory ? { subcategory } : {}),
  supported,
  variants,
});

/**
 * park: playground (10, 4 with photos), dog_park (5), and 3 places with no subcategory.
 * history: monument (7, all named, 2 described). volcano: unsupported (2).
 */
const SURVEY: PlaceAtlasSurveyResult = {
  cells: 3,
  places: 27,
  tileBytes: 9000,
  photoFiles: 14,
  mediaBytesEstimate: 1_400_000,
  buckets: [
    bucket("park", "playground", [v("PNd", 4, 8), v("pNd", 5), v("pnd", 1)]),
    bucket("park", "dog_park", [v("pNd", 5)]),
    bucket("park", undefined, [v("Pnd", 3, 2)]),
    bucket("history", "monument", [v("pND", 2), v("pNd", 5)]),
    bucket("volcano", "caldera", [v("PND", 2, 4)], false),
  ],
  sources: [{ id: "osm", places: 27 }],
};
const ROWS = typeRowsFromSurvey(SURVEY);
const row = (category: string) => ROWS.find((r) => r.category === category)!;

describe("resolveAtlasTarget", () => {
  it("swaps a URL for the version the inspect resolved it to", () => {
    expect(
      resolveAtlasTarget({ url: "https://h/us-west/" }, { versionUrl: "https://h/us-west/v3/" }),
    ).toEqual({ url: "https://h/us-west/v3/" });
  });

  it("keeps the typed URL from an older server, and leaves other targets alone", () => {
    expect(resolveAtlasTarget({ url: "https://h/us-west/v3" }, {})).toEqual({
      url: "https://h/us-west/v3",
    });
    expect(resolveAtlasTarget({ path: "us-west" }, { versionUrl: "https://h/x/" })).toEqual({
      path: "us-west",
    });
    expect(resolveAtlasTarget({ staged: "01J0" }, { versionUrl: "https://h/x/" })).toEqual({
      staged: "01J0",
    });
  });
});

describe("type rows", () => {
  it("folds buckets into sorted categories, the no-subcategory row last", () => {
    expect(ROWS).toEqual<AtlasTypeRow[]>([
      { category: "history", supported: true, subcategories: ["monument"] },
      {
        category: "park",
        supported: true,
        subcategories: ["dog_park", "playground", NO_SUBCATEGORY],
      },
      { category: "volcano", supported: false, subcategories: ["caldera"] },
    ]);
  });

  it("from a preview: no subcategories, support judged by the console's vocabulary", () => {
    expect(typeRowsFromPreview({ categories: ["park", "volcano", "park"] })).toEqual([
      { category: "park", supported: true, subcategories: [] },
      { category: "volcano", supported: false, subcategories: [] },
    ]);
    expect(typeRowsFromPreview({})).toEqual([]);
  });

  it("select all takes every supported type with every subcategory", () => {
    expect(selectAllTypes(ROWS)).toEqual({
      history: ["monument"],
      park: ["dog_park", "playground", NO_SUBCATEGORY],
    });
  });

  it("unticking a category's last subcategory unticks the category", () => {
    let sel = toggleCategory({}, row("history"), true);
    expect(sel).toEqual({ history: ["monument"] });
    sel = toggleSubcategory(sel, row("history"), "monument", false);
    expect(sel).toEqual({});
    // Re-ticking keeps the row's order, whatever order the clicks came in.
    sel = toggleSubcategory({}, row("park"), NO_SUBCATEGORY, true);
    sel = toggleSubcategory(sel, row("park"), "dog_park", true);
    expect(sel).toEqual({ park: ["dog_park", NO_SUBCATEGORY] });
  });
});

describe("wireTypes: send a filter only when it narrows", () => {
  it("everything selected sends neither categories nor skipTypes", () => {
    expect(wireTypes(ROWS, selectAllTypes(ROWS))).toEqual({ problems: [] });
  });

  it("an unsupported type left out does not count as narrowing", () => {
    // volcano is never selectable; leaving it out is still "everything".
    expect(wireTypes(ROWS, selectAllTypes(ROWS)).categories).toBeUndefined();
  });

  it("a dropped category sends the categories kept, not skip pairs", () => {
    const sel = toggleCategory(selectAllTypes(ROWS), row("history"), false);
    expect(wireTypes(ROWS, sel)).toEqual({ categories: ["park"], problems: [] });
  });

  it("a category emptied one subcategory at a time goes in categories too", () => {
    const sel = toggleSubcategory(selectAllTypes(ROWS), row("history"), "monument", false);
    expect(wireTypes(ROWS, sel)).toEqual({ categories: ["park"], problems: [] });
  });

  it("an unticked subcategory becomes exactly one skip pair", () => {
    const sel = toggleSubcategory(selectAllTypes(ROWS), row("park"), "dog_park", false);
    expect(wireTypes(ROWS, sel)).toEqual({
      skipTypes: [{ category: "park", subcategory: "dog_park" }],
      problems: [],
    });
  });

  it("an unticked no-subcategory row is a pair without a subcategory", () => {
    const sel = toggleSubcategory(selectAllTypes(ROWS), row("park"), NO_SUBCATEGORY, false);
    expect(wireTypes(ROWS, sel)).toEqual({ skipTypes: [{ category: "park" }], problems: [] });
  });

  it("keeping only the no-subcategory places is expressible", () => {
    const out = wireTypes(ROWS, { park: [NO_SUBCATEGORY] });
    expect(out).toEqual({
      categories: ["park"],
      skipTypes: [
        { category: "park", subcategory: "dog_park" },
        { category: "park", subcategory: "playground" },
      ],
      problems: [],
    });
    expect(
      placeAtlasImportParamsSchema.safeParse({
        url: "https://h/v/",
        publisher: PUBLISHER,
        categories: out.categories,
        options: { skipTypes: out.skipTypes },
      }).success,
    ).toBe(true);
  });

  it("a slug shared by two categories is skipped under one only", () => {
    const rows: AtlasTypeRow[] = [
      { category: "park", supported: true, subcategories: ["garden"] },
      { category: "history", supported: true, subcategories: ["garden", "monument"] },
    ];
    expect(wireTypes(rows, { park: ["garden"], history: ["monument"] })).toEqual({
      skipTypes: [{ category: "history", subcategory: "garden" }],
      problems: [],
    });
  });

  it("nothing selected is a problem", () => {
    expect(wireTypes(ROWS, {}).problems).toEqual(["Choose at least one place type."]);
  });

  it("refuses more types than the wire carries, and names it when all are taken", () => {
    const rows: AtlasTypeRow[] = Array.from({ length: 18 }, (_, i) => ({
      category: `type_${i}`,
      supported: true,
      subcategories: [],
    }));
    const all = selectAllTypes(rows);
    expect(wireTypes(rows, all).problems).toEqual([]);
    const most = toggleCategory(all, rows[0]!, false);
    // 17 kept is over the cap of 16 (and these are not categories the console can name).
    expect(wireTypes(rows, most).problems.some((p) => p.includes("at most 16"))).toBe(true);
  });

  it("refuses more skip pairs than the wire carries", () => {
    const subs = Array.from({ length: 300 }, (_, i) => `s${i}`);
    const rows: AtlasTypeRow[] = [{ category: "park", supported: true, subcategories: subs }];
    const out = wireTypes(rows, { park: ["s0"] });
    expect(out.skipTypes).toHaveLength(299);
    expect(out.problems.some((p) => p.includes("at most 256"))).toBe(true);
  });

  it("a server without survey rows sends no types at all", () => {
    expect(wireTypes([], {})).toEqual({ problems: [] });
  });
});

describe("estimates", () => {
  it("tallyBuckets counts places, places with photos and photo files under the filters", () => {
    expect(tallyBuckets(SURVEY.buckets.slice(0, 1), NO_CONTENT_FILTERS)).toEqual({
      places: 10,
      withPhotos: 4,
      photoFiles: 8,
    });
    expect(
      tallyBuckets(SURVEY.buckets.slice(0, 1), { ...NO_CONTENT_FILTERS, requireName: true }),
    ).toEqual({ places: 9, withPhotos: 4, photoFiles: 8 });
  });

  it("the whole selection skips unsupported places and prices photos at the average file size", () => {
    const types = wireTypes(ROWS, selectAllTypes(ROWS));
    expect(estimateImport(SURVEY, types, NO_CONTENT_FILTERS)).toEqual({
      places: 25,
      photoFiles: 10,
      mediaBytes: 1_000_000,
      dataBytes: 8333, // 25 of the 27 places' 9000 bytes of tile data
    });
  });

  it("follows what is sent: a skip pair drops exactly its own places", () => {
    const noDogs = toggleSubcategory(selectAllTypes(ROWS), row("park"), "dog_park", false);
    // playground 10 + no-subcategory 3 + monument 7.
    expect(estimateImport(SURVEY, wireTypes(ROWS, noDogs), NO_CONTENT_FILTERS)).toEqual({
      places: 20,
      photoFiles: 10,
      mediaBytes: 1_000_000,
      dataBytes: 6667,
    });
    // A pair without a subcategory skips park's 3 unsubcategorized places, not all of park.
    const noBare = toggleSubcategory(selectAllTypes(ROWS), row("park"), NO_SUBCATEGORY, false);
    expect(estimateImport(SURVEY, wireTypes(ROWS, noBare), NO_CONTENT_FILTERS)).toEqual({
      places: 22,
      photoFiles: 8,
      mediaBytes: 800_000,
      dataBytes: 7333,
    });
  });

  it("content filters AND together", () => {
    const types = wireTypes(ROWS, selectAllTypes(ROWS));
    expect(
      estimateImport(SURVEY, types, { ...NO_CONTENT_FILTERS, requireDescription: true }).places,
    ).toBe(2);
    expect(
      estimateImport(SURVEY, types, {
        requirePhotos: true,
        requireName: true,
        requireDescription: false,
      }).places,
    ).toBe(4);
  });

  it("an area with no photos estimates zero bytes rather than dividing by zero", () => {
    const empty = { ...SURVEY, photoFiles: 0, mediaBytesEstimate: 0, buckets: [] };
    expect(estimateImport(empty, {}, NO_CONTENT_FILTERS)).toEqual({
      places: 0,
      photoFiles: 0,
      mediaBytes: 0,
      dataBytes: 0,
    });
  });
});

describe("import params", () => {
  const base = {
    target: { url: "https://h/us-west/" },
    preview: { publisher: PUBLISHER, versionUrl: "https://h/us-west/v3/" },
    cells: [] as string[],
    options: undefined,
  };

  it("the defaults send the resolved URL and the publisher, and nothing else", () => {
    const params = buildImportParams(base);
    expect(params).toEqual({ url: "https://h/us-west/v3/", publisher: PUBLISHER });
    expect(placeAtlasImportParamsSchema.safeParse(params).success).toBe(true);
  });

  it("every choice lands where the wire expects it, and validates", () => {
    const params = buildImportParams({
      ...base,
      cells: ["9q5", "9q4c"],
      categories: ["park"],
      options: buildImportOptions({
        skipTypes: [{ category: "park", subcategory: "dog_park" }],
        filters: { requirePhotos: true, requireName: false, requireDescription: true },
        importPhotos: false,
        retireMissing: false,
        retireFiltered: false,
        retireUnselectedTypes: false,
      }),
    });
    expect(params).toEqual({
      url: "https://h/us-west/v3/",
      publisher: PUBLISHER,
      cells: ["9q5", "9q4c"],
      categories: ["park"],
      options: {
        skipTypes: [{ category: "park", subcategory: "dog_park" }],
        requirePhotos: true,
        requireDescription: true,
        importPhotos: false,
        retireMissing: false,
      },
    });
    expect(placeAtlasImportParamsSchema.safeParse(params).success).toBe(true);
  });

  it("buildImportOptions is absent when nothing differs from the defaults", () => {
    expect(
      buildImportOptions({
        filters: NO_CONTENT_FILTERS,
        importPhotos: true,
        retireMissing: true,
        retireFiltered: false,
        retireUnselectedTypes: false,
      }),
    ).toBeUndefined();
  });

  it("describeImportOptions words a run's recorded options, defaults silent", () => {
    expect(describeImportOptions(undefined)).toEqual([]);
    expect(describeImportOptions({ importPhotos: true, retireMissing: true })).toEqual([]);
    expect(
      describeImportOptions({
        skipTypes: [{ category: "park", subcategory: "dog_park" }, { category: "park" }],
        requireName: true,
        importPhotos: false,
        retireMissing: false,
      }),
    ).toEqual([
      "skips park · dog_park, park (no subcategory)",
      "skips unnamed places",
      "photo files not downloaded",
      "places missing from the version kept",
    ]);
    expect(
      describeImportOptions({ requirePhotos: true, requireName: true, retireFiltered: true }),
    ).toEqual([
      "skips places without photos",
      "skips unnamed places",
      "retires places already imported that are skipped by the photo and name filters, inside the area",
    ]);
  });

  it("describeImportOptions says nothing of retireFiltered with no content filter on", () => {
    expect(describeImportOptions({ retireFiltered: true })).toEqual([]);
  });

  it("buildImportOptions sends retireFiltered only with a content filter on", () => {
    const base = {
      importPhotos: true,
      retireMissing: true,
      retireFiltered: true,
      retireUnselectedTypes: false,
    };
    expect(buildImportOptions({ ...base, filters: NO_CONTENT_FILTERS })).toBeUndefined();
    expect(
      buildImportOptions({
        ...base,
        skipTypes: [{ category: "park" }],
        filters: NO_CONTENT_FILTERS,
      }),
    ).toEqual({ skipTypes: [{ category: "park" }] });
    expect(
      buildImportOptions({ ...base, filters: { ...NO_CONTENT_FILTERS, requirePhotos: true } }),
    ).toEqual({ requirePhotos: true, retireFiltered: true });
  });
});

describe("formatBytes", () => {
  it("uses decimal units with one decimal under ten", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_500)).toBe("1.5 KB");
    expect(formatBytes(812_000)).toBe("812 KB");
    expect(formatBytes(1_400_000_000)).toBe("1.4 GB");
  });
});

describe("the switches and the confirm summary", () => {
  const photos = { requirePhotos: true, requireName: false, requireDescription: false };
  const off = { retireFiltered: false, retireUnselectedTypes: false };
  type Choices = Parameters<typeof buildImportOptions>[0];
  /** What the switches read for these choices: the categories and the options the import sends. */
  const sent = (input: Choices) => ({
    categories: input.categories as AtlasSwitchInput["categories"],
    options: buildImportOptions(input),
  });
  const summary = (input: Choices) =>
    describeSwitches(sent(input)).map((sw) => `${sw.label}: ${sw.on ? "on" : "off"}, ${sw.effect}`);

  it("states every switch, on or off, in the order the form shows them", () => {
    expect(
      summary({
        filters: photos,
        categories: ["park"],
        importPhotos: true,
        retireMissing: true,
        retireFiltered: true,
        retireUnselectedTypes: true,
      }),
    ).toEqual([
      "Download photo files: on, photos the server does not have yet are downloaded",
      "Retire places missing from this version: on, places this version no longer has are retired, in the map cells this import reads",
      "Retire places these filters skip: on, places the filters skip are retired, inside the area",
      "Retire place types left out: on, places of any type not selected are retired, inside the area",
    ]);
    expect(
      summary({
        filters: photos,
        categories: ["park"],
        importPhotos: false,
        retireMissing: false,
        ...off,
      }),
    ).toEqual([
      "Download photo files: off, places only; photos a place already has are kept",
      "Retire places missing from this version: off, places this version no longer has are kept",
      "Retire places these filters skip: off, places the filters skip are left as they are",
      "Retire place types left out: off, places of the types left out are left as they are",
    ]);
  });

  it("reads the clean-up switches as unavailable while there is nothing for them to retire", () => {
    const input = sent({
      filters: NO_CONTENT_FILTERS,
      importPhotos: true,
      retireMissing: true,
      retireFiltered: true,
      retireUnselectedTypes: true,
    });
    expect(switchState("retireFiltered", input)).toBe("unavailable");
    expect(switchState("retireUnselectedTypes", input)).toBe("unavailable");
    expect(switchHint("retireFiltered", "unavailable")).toBe(
      "Set one of the filters above to Skip to use this.",
    );
    expect(switchHint("retireUnselectedTypes", "unavailable")).toBe(
      "Leave out a place type above to use this.",
    );
    expect(describeSwitches(input).slice(2)).toMatchObject([
      { on: false, effect: "no filter is set to Skip" },
      { on: false, effect: "every place type is selected" },
    ]);
  });

  it("counts a skipped subcategory as a type left out", () => {
    const input = sent({
      filters: NO_CONTENT_FILTERS,
      skipTypes: [{ category: "park", subcategory: "dog_park" }],
      importPhotos: true,
      retireMissing: true,
      ...off,
      retireUnselectedTypes: true,
    });
    expect(input.options).toEqual({
      skipTypes: [{ category: "park", subcategory: "dog_park" }],
      retireUnselectedTypes: true,
    });
    expect(switchState("retireUnselectedTypes", input)).toBe("on");
  });

  it("is on for a switch exactly when what the import sends carries it", () => {
    for (const filters of [NO_CONTENT_FILTERS, photos]) {
      for (const categories of [undefined, ["park" as const]]) {
        for (const importPhotos of [true, false]) {
          for (const retireMissing of [true, false]) {
            for (const retireFiltered of [true, false]) {
              for (const retireUnselectedTypes of [true, false]) {
                const input = sent({
                  filters,
                  categories,
                  importPhotos,
                  retireMissing,
                  retireFiltered,
                  retireUnselectedTypes,
                });
                const o = input.options;
                const [photosRow, missingRow, filteredRow, typesRow] = describeSwitches(input);
                expect(photosRow!.on).toBe(o?.importPhotos !== false);
                expect(missingRow!.on).toBe(o?.retireMissing !== false);
                expect(filteredRow!.on).toBe(o?.retireFiltered === true);
                expect(typesRow!.on).toBe(o?.retireUnselectedTypes === true);
              }
            }
          }
        }
      }
    }
  });

  it("adds the estimate to the photos hint when there is one", () => {
    expect(switchHint("importPhotos", "on", { photoFiles: 1200, mediaBytes: 3_100_000_000 })).toBe(
      "This import downloads the photos for these places that the server does not have yet: up to 1,200 files, about 3.1 GB.",
    );
    expect(switchHint("importPhotos", "on")).toBe(
      "This import downloads the photos for these places that the server does not have yet.",
    );
  });

  it("lists the content filters the import sends", () => {
    expect(describeSkipped(undefined)).toEqual([]);
    expect(
      describeSkipped({ requirePhotos: true, requireName: true, requireDescription: true }),
    ).toEqual(["places without photos", "unnamed places", "places without a description"]);
  });

  it("words a recorded run that retired the types it left out, and only when it left one out", () => {
    expect(describeImportOptions({ retireUnselectedTypes: true }, ["park"])).toEqual([
      "retires places already imported of the types left out, inside the area",
    ]);
    expect(describeImportOptions({ retireUnselectedTypes: true })).toEqual([]);
  });
});
