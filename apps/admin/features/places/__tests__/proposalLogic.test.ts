import type { PlaceDetail, PlaceProposal } from "@beaconsgg/protocol-types";
import { describe, expect, it } from "vitest";
import { parsePoint, subcategoriesFor } from "../logic";
import {
  amendmentFor,
  describeValue,
  diffProposal,
  isAmendable,
  proposalMediaHashes,
} from "../proposalLogic";

const PHOTO = { type: "image", role: "thumb" as const, hash: "abc", uris: ["abc@h"] };

function proposal(over: Partial<PlaceProposal> = {}): PlaceProposal {
  return {
    id: "01AAAAAAAAAAAAAAAAAAAAAAAA",
    proposedBy: "did:key:zContributor",
    credit: false,
    fields: { description: "A 1904 Olmsted park." },
    status: "pending",
    createdAt: "2026-07-31T00:00:00.000Z",
    ...over,
  };
}

const place = (over: Partial<PlaceDetail> = {}): PlaceDetail => ({
  unique: "01BBBBBBBBBBBBBBBBBBBBBBBB",
  category: "park",
  point: { lat: 47.61, lng: -122.33 },
  hasGeometry: false,
  hasDescription: false,
  updatedAt: "2026-07-31T00:00:00.000Z",
  sources: [],
  ...over,
});

describe("diffProposal — what a reviewer is actually deciding", () => {
  it("a hole-fill overwrites nothing", () => {
    const changes = diffProposal(proposal(), place()); // the place has no description
    expect(changes).toEqual([
      {
        field: "description",
        current: undefined,
        proposed: "A 1904 Olmsted park.",
        overwrites: false,
      },
    ]);
  });

  it("flags a field that would replace an existing value", () => {
    const changes = diffProposal(
      proposal({ fields: { name: "Volunteer Park!" } }),
      place({ name: "Volunteer Park" }),
    );
    expect(changes[0]).toMatchObject({ current: "Volunteer Park", overwrites: true });
  });

  it("an identical resubmission isn't an overwrite (key order doesn't matter)", () => {
    const changes = diffProposal(
      proposal({ fields: { media: [PHOTO] } }),
      place({ media: [{ role: "thumb", uris: ["abc@h"], hash: "abc", type: "image" }] }),
    );
    expect(changes[0]?.overwrites).toBe(false);
  });

  it("a new-place proposal has no current side at all", () => {
    const changes = diffProposal(
      proposal({ fields: { category: "park", subcategory: "play", name: "Pocket Park" } }),
      undefined,
    );
    expect(changes).toHaveLength(3);
    expect(changes.every((c) => c.current === undefined && !c.overwrites)).toBe(true);
  });
});

describe("amendmentFor — only what the reviewer actually changed", () => {
  it("sends nothing when the drafts still match the submission", () => {
    const p = proposal({ fields: { name: "Pocket Park", description: "Nice." } });
    expect(amendmentFor(p, { name: "Pocket Park", description: "Nice." })).toBeUndefined();
    expect(amendmentFor(p, {})).toBeUndefined();
  });

  it("sends only the edited fields", () => {
    const p = proposal({ fields: { name: "pocket park", description: "Nice." } });
    expect(amendmentFor(p, { name: "Pocket Park", description: "Nice." })).toEqual({
      name: "Pocket Park",
    });
  });

  it("ignores a blanked draft rather than sending an empty string", () => {
    // Clearing a field isn't an amendment — the operator rejects, or edits after approval.
    expect(amendmentFor(proposal({ fields: { name: "X" } }), { name: "   " })).toBeUndefined();
  });

  it("only the free-text fields are amendable at all", () => {
    // `category` is a closed enum the review op would 400 on, and `subcategory` must be a curated
    // PAIR that review deliberately doesn't re-validate — so neither is editable inline.
    expect(isAmendable("name")).toBe(true);
    expect(isAmendable("description")).toBe(true);
    expect(isAmendable("website")).toBe(true);
    expect(isAmendable("category")).toBe(false);
    expect(isAmendable("subcategory")).toBe(false);
    expect(isAmendable("media")).toBe(false);
    expect(isAmendable("point")).toBe(false);
  });
});

describe("review helpers", () => {
  it("describeValue renders each wire shape a contribution can carry", () => {
    expect(describeValue(undefined)).toBe("—");
    expect(describeValue("A park")).toBe("A park");
    expect(describeValue(["a", "b"])).toBe("a, b");
    expect(describeValue([PHOTO])).toBe("1 item");
    expect(describeValue({ lat: 47.61, lng: -122.33 })).toBe("47.61000, -122.33000");
  });

  it("proposalMediaHashes dedupes the thumb/full pair down to its hashes", () => {
    const p = proposal({
      fields: { media: [PHOTO, { ...PHOTO, role: "full" }, { ...PHOTO, hash: "def" }] },
    });
    expect(proposalMediaHashes(p)).toEqual(["abc", "def"]);
    expect(proposalMediaHashes(proposal())).toEqual([]);
  });

  it("subcategoriesFor is empty without a category and namespaces by it", () => {
    const taxonomy = {
      categories: [
        { category: "nature" as const, subcategories: ["water", "mountain"] },
        { category: "transport" as const, subcategories: ["rail", "water"] },
      ],
    };
    expect(subcategoriesFor(taxonomy, "")).toEqual([]);
    expect(subcategoriesFor(undefined, "nature")).toEqual([]); // still loading
    expect(subcategoriesFor(taxonomy, "nature")).toEqual(["water", "mountain"]);
    expect(subcategoriesFor(taxonomy, "park")).toEqual([]);
  });
});

describe("parsePoint — the New place form's coordinate gate", () => {
  it("accepts an in-range pair and trims", () => {
    expect(parsePoint(" 47.61 ", "-122.33")).toEqual({ lat: 47.61, lng: -122.33 });
    expect(parsePoint("0", "0")).toEqual({ lat: 0, lng: 0 }); // null island is a real coordinate
  });

  it("rejects blanks, junk, and out-of-range values", () => {
    expect(parsePoint("", "-122.33")).toBeUndefined();
    expect(parsePoint("47.61", "")).toBeUndefined();
    expect(parsePoint("north", "-122.33")).toBeUndefined();
    expect(parsePoint("91", "0")).toBeUndefined();
    expect(parsePoint("0", "181")).toBeUndefined();
  });
});
