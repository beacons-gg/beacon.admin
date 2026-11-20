import { describe, expect, it } from "vitest";
import { CATALOG, OTHER } from "../catalog";
import {
  baselineOf,
  blankNumbers,
  parseList,
  formatValue,
  pendingChanges,
  rowStatus,
  issuesByRow,
  sameValue,
  sections,
} from "../logic";
import { setting } from "./fixtures";

describe("rowStatus", () => {
  it("says a field is on its built-in default, and names the variable that would change it", () => {
    expect(rowStatus(setting())).toEqual({
      tone: "neutral",
      label: "Built-in default",
      detail: "BEACON_MAILBOX_TTL is not set in this server's environment.",
    });
  });

  /*
   * The distinction `configured` exists for: a field on its default and a field an operator set to
   * that same value are otherwise indistinguishable, on the one screen built to answer "I set that
   * variable and nothing changed".
   */
  it("distinguishes a value the environment supplies from the same value as a default", () => {
    expect(rowStatus(setting({ configured: true })).label).toBe("From the environment");
    expect(rowStatus(setting({ configured: false })).label).toBe("Built-in default");
  });

  it("credits an override, and keeps the DID out of the sentence", () => {
    const status = rowStatus(
      setting({
        provenance: "admin",
        value: 900,
        updatedBy: "did:key:z6MkOperator",
        updatedAt: "2026-09-03T18:00:00.000Z",
      }),
    );
    expect(status.tone).toBe("ok");
    expect(status.detail).toBe("Set by an operator on 2026-09-03.");
    expect(status.actor).toBe("did:key:z6MkOperator");
  });

  it("says what a reset would restore, when the environment disagrees with the override", () => {
    const status = rowStatus(
      setting({
        provenance: "admin",
        value: 900,
        envValue: 300,
        updatedAt: "2026-09-03T00:00:00.000Z",
      }),
    );
    expect(status.detail).toContain("BEACON_MAILBOX_TTL says 300, and a reset would restore it");
  });

  it("does not claim a disagreement when the override matches the environment", () => {
    const status = rowStatus(
      setting({
        provenance: "admin",
        value: 300,
        envValue: 300,
        updatedAt: "2026-09-03T00:00:00.000Z",
      }),
    );
    expect(status.detail).not.toContain("would restore");
  });

  /*
   * The two `storedReason` cases leave an identical shape and want opposite things, which is why the
   * server splits them. A shared "not in force" badge would tell an operator nothing to act on.
   */
  it("tells a dormant capability apart from a clamped ceiling, by remedy", () => {
    const dormant = rowStatus(
      setting({
        key: "placesContributionsEnabled",
        env: "BEACON_PLACES_PROPOSALS",
        provenance: "admin",
        value: false,
        storedValue: true,
        storedReason: "prerequisite",
      }),
    );
    expect(dormant.tone).toBe("warn");
    expect(dormant.detail).toContain("until the capability it depends on is back on");
    expect(dormant.detail).not.toContain("restart");

    const clamped = rowStatus(
      setting({
        key: "mediaMaxBytes",
        env: "BEACON_MEDIA_MAX_BYTES",
        provenance: "admin",
        value: 1000,
        storedValue: 5000,
        storedReason: "ceiling",
      }),
    );
    expect(clamped.tone).toBe("warn");
    expect(clamped.detail).toContain("Raise BEACON_MEDIA_MAX_BYTES and restart");
    expect(clamped.detail).not.toContain("capability");
  });

  /*
   * The whole sentence a row says about itself lives in one place, so all of it is testable. The
   * restart clause used to be appended by the component, where nothing could assert it.
   */
  it("tells a read-only field what its remedy is, and does not tell an editable one", () => {
    expect(rowStatus(setting({ editable: false, configured: true })).detail).toBe(
      "BEACON_MAILBOX_TTL supplies this. A restart is the only way to change it.",
    );
    expect(rowStatus(setting({ editable: false, configured: false })).detail).toContain(
      "A restart is the only way",
    );
    expect(rowStatus(setting({ editable: true, configured: true })).detail).not.toContain(
      "restart",
    );
  });

  it("reports a secret as set or unset, since a read never learns more", () => {
    const secret = setting({
      key: "databaseUrl",
      env: "BEACON_DATABASE_URL",
      editable: false,
      secret: true,
      configured: true,
      value: undefined,
    });
    expect(rowStatus(secret).label).toBe("From the environment");
    expect(formatValue(secret.value)).toBe("not set");
  });
});

describe("the edit buffer", () => {
  /*
   * The baseline is the operator's stated intent, not what is in force. Starting a clamped control
   * on the in-force number would quietly offer to overwrite a choice they made and still hold.
   */
  it("measures an edit against the stored intent, not the value in force", () => {
    const clamped = setting({ value: 1000, storedValue: 5000, storedReason: "ceiling" });
    expect(baselineOf(clamped)).toBe(5000);
    expect(pendingChanges([clamped], { [clamped.key]: 5000 })).toEqual({});
    expect(pendingChanges([clamped], { [clamped.key]: 1000 })).toEqual({ [clamped.key]: 1000 });
  });

  it("drops an edit that lands back on where it started", () => {
    const row = setting({ value: 600 });
    expect(pendingChanges([row], { [row.key]: 900 })).toEqual({ [row.key]: 900 });
    expect(pendingChanges([row], { [row.key]: 600 })).toEqual({});
  });

  it("compares lists by contents, not by identity", () => {
    const row = setting({ key: "coverage", env: "BEACON_COVERAGE", value: ["u", "v"] });
    expect(pendingChanges([row], { coverage: ["u", "v"] })).toEqual({});
    expect(pendingChanges([row], { coverage: ["u"] })).toEqual({ coverage: ["u"] });
    expect(sameValue(["a"], ["a"])).toBe(true);
    expect(sameValue(["a"], ["b"])).toBe(false);
  });

  /*
   * Clearing and resetting are different ops with different outcomes: `null` stores "no value" and
   * the override stands, while a reset drops the row and lets the environment supply it again.
   */
  it("treats clearing a value as a change, and clearing an empty one as nothing", () => {
    const has = setting({ key: "contact", env: "BEACON_CONTACT", value: "ops@example" });
    expect(pendingChanges([has], { contact: null })).toEqual({ contact: null });

    const hasNot = setting({ key: "contact", env: "BEACON_CONTACT", value: undefined });
    expect(pendingChanges([hasNot], { contact: null })).toEqual({});
  });

  /*
   * `setMany` refuses the whole patch before storing any of it, so one empty number box would cost
   * every other edit in the buffer a round trip to learn what the console already knows.
   */
  it("names an empty number box, so a save is not spent finding out", () => {
    const rows = [
      setting({ key: "mailboxTtlSeconds" }),
      setting({ key: "mailboxMaxBody", env: "BEACON_MAILBOX_MAX_BODY" }),
      setting({ key: "name", env: "BEACON_NAME", value: "Northwind" }),
    ];
    const pending = { mailboxTtlSeconds: "", mailboxMaxBody: 12, name: "" };
    // Labelled, not just counted: on a 69-row page "two number fields are empty" sends an operator
    // hunting for something the console can name.
    expect(blankNumbers(rows, pending)).toEqual([
      { key: "mailboxTtlSeconds", label: "Message TTL" },
    ]);
  });

  it("never sends a key the server did not report", () => {
    expect(pendingChanges([setting()], { somethingElse: 1 })).toEqual({});
  });
});

describe("parseList", () => {
  it("trims entries and drops the empties, matching the server's csv()", () => {
    expect(parseList("u4, gcp ,,ezs", undefined)).toEqual(["u4", "gcp", "ezs"]);
  });

  /*
   * The state this exists for. `games: []` is the documented default (open to every game) and
   * `gameSlugSchema` refuses `""`, so a box that emitted `[""]` when cleared left an operator who had
   * restricted a server unable to reopen it from this screen at all.
   */
  it("reads an empty box as the empty list, so a restricted server can be reopened", () => {
    expect(parseList("", undefined)).toEqual([]);
    expect(parseList("  ,  ", undefined)).toEqual([]);
  });

  /*
   * `coverage` is the one setting `loadConfig` floors from `[]` to `[""]`, so it is the one place an
   * empty box has to mean something other than the empty list.
   */
  it("honours the setting's own reading of empty, where it has one", () => {
    expect(parseList("", [""])).toEqual([""]);
    expect(parseList("u4", [""])).toEqual(["u4"]);
  });
});

describe("issuesByRow", () => {
  const issue = (key: string) => ({ key, path: "", message: "nope" });

  it("puts each refusal with the row that will render it", () => {
    const { byKey, orphaned } = issuesByRow(
      [issue("name"), issue("coverage"), issue("name")],
      [setting({ key: "name" }), setting({ key: "coverage" })],
    );
    expect(byKey.get("name")).toHaveLength(2);
    expect(byKey.get("coverage")).toHaveLength(1);
    expect(orphaned).toEqual([]);
  });

  /*
   * A refusal naming a key this server never reported has no row to land on, and dropping it would
   * leave a failed save with nothing on screen to explain it.
   */
  it("keeps a refusal that names a key no row will render", () => {
    const { byKey, orphaned } = issuesByRow([issue("redisUrl")], [setting({ key: "name" })]);
    expect(byKey.size).toBe(0);
    expect(orphaned).toEqual([issue("redisUrl")]);
  });
});

describe("sections", () => {
  it("keeps the server's order within a section, and the declared order between them", () => {
    const rows = [
      setting({ key: "mailboxTtlSeconds", env: "BEACON_MAILBOX_TTL" }),
      setting({ key: "name", env: "BEACON_NAME", value: "Northwind" }),
      setting({ key: "mailboxMaxBody", env: "BEACON_MAILBOX_MAX_BODY" }),
    ];
    expect(sections(rows).map((s) => s.group)).toEqual(["Identity", "Mailbox"]);
    expect(sections(rows)[1]?.rows.map((r) => r.setting.key)).toEqual([
      "mailboxTtlSeconds",
      "mailboxMaxBody",
    ]);
  });

  it("renders a key nobody has catalogued, at the end", () => {
    const result = sections([setting({ key: "redisUrl", value: "redis://x" }), setting()]);
    expect(result.map((s) => s.group)).toEqual(["Mailbox", OTHER]);
  });

  /*
   * `about` arrived after servers already in the field. One that predates it reports no such key,
   * and the catalog entry must then render nowhere rather than as an empty row that a save would
   * send to a server that refuses it. A newer server files it under Identity as a counted textarea.
   */
  it("shows About only for a server that reports it, under Identity as a textarea", () => {
    const old = [setting({ key: "name", env: "BEACON_NAME", value: "Northwind" })];
    expect(sections(old).flatMap((s) => s.rows.map((r) => r.setting.key))).toEqual(["name"]);
    const current = [...old, setting({ key: "about", env: "BEACON_ABOUT", value: "" })];
    const identity = sections(current).find((s) => s.group === "Identity");
    expect(identity?.rows.map((r) => r.setting.key)).toEqual(["name", "about"]);
    const about = identity?.rows.find((r) => r.setting.key === "about")?.entry;
    expect(about?.kind).toBe("textarea");
    expect(about?.maxLength).toBe(8192);
  });

  it("drops a section no row landed in rather than rendering it empty", () => {
    expect(sections([setting()]).map((s) => s.group)).toEqual(["Mailbox"]);
  });

  /*
   * Rendering only the declared group list is what puts the sections in order, and it would also let
   * one mistyped group name in a 69-entry table delete a setting from the screen with nothing to
   * show for it. A misfiled row is visibly misfiled instead.
   */
  it("shows a row whose catalog entry names a group that does not exist", () => {
    CATALOG["misfiled"] = { group: "Typo", label: "Misfiled", kind: "text" };
    try {
      const result = sections([setting({ key: "misfiled", value: "x" })]);
      expect(result).toEqual([
        { group: OTHER, rows: [{ setting: expect.anything(), entry: CATALOG["misfiled"] }] },
      ]);
    } finally {
      delete CATALOG["misfiled"];
    }
  });
});

describe("formatValue", () => {
  it("says what an operator would say", () => {
    expect(formatValue(true)).toBe("on");
    expect(formatValue(false)).toBe("off");
    expect(formatValue(["a", "b"])).toBe("a, b");
    expect(formatValue([])).toBe("empty");
    expect(formatValue("")).toBe("empty");
    expect(formatValue(undefined)).toBe("not set");
    expect(formatValue(5000)).toBe("5000");
  });
});
