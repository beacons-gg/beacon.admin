import { describe, expect, it } from "vitest";
import { CATALOG, entryFor, GROUPS, humanise, inferKind, OTHER } from "../catalog";
import { setting } from "./fixtures";

describe("catalog", () => {
  /*
   * `sections` renders GROUPS in order, so a group name only the catalog knows about would file its
   * rows under "Unlisted" instead of where they belong. Cheap to assert, and the failure it prevents
   * is a setting the operator cannot find.
   */
  it("files every entry under a declared group", () => {
    const declared = new Set<string>(GROUPS);
    const stray = Object.entries(CATALOG)
      .filter(([, entry]) => !declared.has(entry.group))
      .map(([key, entry]) => `${key} -> ${entry.group}`);
    expect(stray).toEqual([]);
  });

  it("gives every select its options, since a select without them cannot be used", () => {
    const empty = Object.entries(CATALOG)
      .filter(([, e]) => e.kind === "select" && (e.options ?? []).length === 0)
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  /*
   * The read-only half states no kind, because it renders no control and a kind there would be an
   * unverifiable claim (one was already wrong: `trustProxy` is `boolean | number`). `entryFor` fills
   * it from the value instead, which is what keeps the contract true if one ever becomes editable.
   */
  it("resolves a control for a read-only entry that declares none", () => {
    expect(CATALOG["docsEnabled"]?.kind).toBeUndefined();
    expect(entryFor(setting({ key: "docsEnabled", editable: false, value: true })).kind).toBe(
      "boolean",
    );
    expect(entryFor(setting({ key: "port", editable: false, value: 3000 })).kind).toBe("number");
    expect(entryFor(setting({ key: "admins", editable: false, value: ["did:key:z"] })).kind).toBe(
      "list",
    );
  });

  /*
   * `emptyValue` is an exception, and an exception on the wrong setting is worse than none: it would
   * put `[""]` where the server wants `[]`. Only `coverage` is floored by `loadConfig`.
   */
  it("declares an empty-box meaning for coverage and for nothing else", () => {
    const declared = Object.entries(CATALOG)
      .filter(([, entry]) => entry.emptyValue !== undefined)
      .map(([key]) => key);
    expect(declared).toEqual(["coverage"]);
    expect(CATALOG["coverage"]?.emptyValue).toEqual([""]);
  });

  it("has the write lock as a switch whose help says what a lock stops", () => {
    expect(CATALOG["writeLocked"]?.kind).toBe("boolean");
    expect(CATALOG["writeLocked"]?.help).toMatch(/players cannot make changes/i);
  });

  it("labels a known key from the catalog", () => {
    const entry = entryFor(setting({ key: "mediaMaxBytes" }));
    expect(entry.label).toBe("Max upload size");
    expect(entry.group).toBe("Media");
    expect(entry.kind).toBe("number");
  });
});

describe("the fallback for a key the catalog has never heard of", () => {
  /*
   * The whole trade behind keeping this table in the console: a setting added on the server arrives
   * unlisted. It has to render, and it has to be obvious that nobody has described it, which is what
   * makes the drift visible to the first person who opens the screen.
   */
  it("renders it in the trailing section, labelled from the key", () => {
    const entry = entryFor(setting({ key: "redisUrl", value: "redis://x" }));
    expect(entry).toEqual({ group: OTHER, label: "Redis url", kind: "text" });
  });

  it("infers a control from each of the four value shapes", () => {
    expect(inferKind(true)).toBe("boolean");
    expect(inferKind(42)).toBe("number");
    expect(inferKind(["a", "b"])).toBe("list");
    expect(inferKind("hello")).toBe("text");
  });

  /*
   * A setting with no value carries no shape either. Every optional runtime setting is a string
   * today, so text is the right guess, and a wrong guess costs a refusal the operator can read
   * rather than a silently mangled write.
   */
  it("guesses text for a setting that has no value to infer from", () => {
    expect(inferKind(undefined)).toBe("text");
  });

  it("humanises a camelCase key", () => {
    expect(humanise("placesQueryMaxCells")).toBe("Places query max cells");
    expect(humanise("mediaS3Bucket")).toBe("Media s3 bucket");
  });
});
