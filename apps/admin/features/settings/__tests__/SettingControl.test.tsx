import type { SettingValue } from "@beaconsgg/protocol-types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedEntry } from "../catalog";
import type { DraftValue } from "../logic";
import { SettingControl } from "../SettingControl";

/*
 * The round-trip: what the panel holds renders into the control, and an operator's gesture comes
 * back out as the value the wire expects. Both halves matter and neither is visible from `logic.ts`.
 * `parseList` has its own tests and they pass a string in; what they cannot say is whether the box
 * an operator types into ever hands it that string, or what it does with the answer.
 *
 * These were unreachable while the suite ran in the `node` environment and collected `.test.ts`
 * only, and most of the defects review found in the settings screen lived in here or next door.
 */

const entry = (over: Partial<ResolvedEntry> = {}): ResolvedEntry => ({
  group: "Mailbox",
  label: "Mailbox TTL",
  kind: "text",
  ...over,
});

/**
 * Render one control wired the way the panel wires it: the parent owns the value and the control
 * only emits.
 *
 * Holding the emitted value in state is not decoration. A control that re-renders from the previous
 * keystroke is the whole subject of `ListInput`, and a harness that threw each emission away would
 * pass for an implementation that dropped every character after the first.
 */
function renderControl(e: ResolvedEntry, initial: DraftValue | undefined): SettingValue[] {
  const emitted: SettingValue[] = [];
  function Host() {
    const [value, setValue] = useState<DraftValue | undefined>(initial);
    return (
      <SettingControl
        id="setting-under-test"
        entry={e}
        value={value}
        disabled={false}
        onChange={(next) => {
          emitted.push(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Host />);
  return emitted;
}

/** The last thing the control emitted, which is what a Save would send. */
const last = (emitted: SettingValue[]): SettingValue | undefined => emitted.at(-1);

describe("boolean", () => {
  it("renders the stored state and emits the other one", async () => {
    const emitted = renderControl(entry({ kind: "boolean" }), true);
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(toggle);
    expect(emitted).toEqual([false]);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  /*
   * Controlled, not merely seeded. The draft is the only thing that says what a row shows, so a
   * switch holding state of its own would drift from it the moment the two disagreed. The parent
   * here ignores the emission, which a `checked` prop that is absent or `undefined` cannot survive:
   * Radix falls back to its own state and the switch moves anyway.
   */
  it("shows what it is given rather than what it was clicked", async () => {
    const onChange = vi.fn();
    render(
      <SettingControl
        id="c"
        entry={entry({ kind: "boolean" })}
        value={undefined}
        disabled={false}
        onChange={onChange}
      />,
    );
    const toggle = screen.getByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });
});

describe("number", () => {
  it("emits a number rather than the string the box holds", async () => {
    const emitted = renderControl(entry({ kind: "number" }), 60);
    await userEvent.type(screen.getByRole("spinbutton"), "0");
    expect(last(emitted)).toBe(600);
    expect(typeof last(emitted)).toBe("number");
  });

  /*
   * The documented refusal to refuse: an empty number box emits `""`, not `0` and not nothing. The
   * value is what `blankNumbers` then catches by name, and `Number("")` is `0`, which would have
   * been a silent write of zero to a TTL.
   */
  it("emits the empty string when the box is cleared, not zero", async () => {
    const emitted = renderControl(entry({ kind: "number" }), 60);
    await userEvent.clear(screen.getByRole("spinbutton"));
    expect(last(emitted)).toBe("");
  });
});

describe("text and textarea", () => {
  it("emits what was typed", async () => {
    const emitted = renderControl(entry({ kind: "text" }), "");
    await userEvent.type(screen.getByRole("textbox"), "ops@example.com");
    expect(last(emitted)).toBe("ops@example.com");
  });

  /*
   * `null` is the wire's "store no value", and the row offers it through Clear. It has to reach the
   * control as an empty box: `String(null)` is `"null"`, which an operator would then have to
   * delete before typing, and would send as a literal on save if they did not.
   */
  /*
   * The count is information, not a gate: typing past the limit goes on emitting, so the server's
   * refusal (which names the field) is what stops an over-long value, as for every other control.
   */
  it("counts against the limit without refusing what goes past it", async () => {
    const emitted = renderControl(entry({ kind: "textarea", maxLength: 5, mono: true }), "abc");
    expect(screen.getByText("3 / 5")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox"), "def");
    expect(last(emitted)).toBe("abcdef");
    expect(screen.getByText("6 / 5").className).toContain("text-destructive");
    expect(screen.getByRole("textbox").className).toContain("font-mono");
  });

  it("renders a cleared value as an empty box, not as the word null", () => {
    renderControl(entry({ kind: "textarea" }), null);
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });
});

describe("list", () => {
  /*
   * The trailing-separator case the docblock is about. Deriving the box from the parsed array looks
   * equivalent: `["a"]` joins back to `"a"`, so the comma the operator just typed disappears from
   * under the cursor and the next entry cannot be started. Asserting the box and the emission
   * separately is the only way to see the difference, because both hold `["a"]`.
   */
  it("keeps the separator the operator typed while emitting the entries so far", async () => {
    const emitted = renderControl(entry({ kind: "list" }), ["a"]);
    const box = screen.getByRole("textbox") as HTMLInputElement;
    await userEvent.type(box, ",");
    expect(box.value).toBe("a,");
    expect(last(emitted)).toEqual(["a"]);
    await userEvent.type(box, " b");
    expect(box.value).toBe("a, b");
    expect(last(emitted)).toEqual(["a", "b"]);
  });

  it("emits the empty list when the box is cleared", async () => {
    const emitted = renderControl(entry({ kind: "list" }), ["game-a"]);
    await userEvent.clear(screen.getByRole("textbox"));
    expect(last(emitted)).toEqual([]);
  });

  /*
   * `coverage` is the one setting whose empty box is not the empty list: `loadConfig` floors it from
   * `[]` to `[""]`, so "everywhere" is spelled as a list holding the empty prefix. Paired with the
   * case above deliberately. Proving the exception on `coverage` alone once produced a bug
   * where the rule that held for one setting was applied to all of them and `games: []`, the
   * documented "open to every game" default, became unreachable from this screen.
   */
  it("emits the setting's own empty value where it has one", async () => {
    const emitted = renderControl(entry({ kind: "list", emptyValue: [""] }), ["9q"]);
    await userEvent.clear(screen.getByRole("textbox"));
    expect(last(emitted)).toEqual([""]);
  });

  /*
   * The re-sync guard. The box holds the operator's text, so a Discard or a save has to be able to
   * put it back; a control that only ever seeded from the first render would keep showing an edit
   * the panel has already thrown away.
   */
  it("re-seeds from a value that changed elsewhere, such as a discard", async () => {
    const original: SettingValue = ["a"];
    function Host() {
      const [value, setValue] = useState<DraftValue | undefined>(original);
      return (
        <>
          <SettingControl
            id="c"
            entry={entry({ kind: "list" })}
            value={value}
            disabled={false}
            onChange={setValue}
          />
          <button type="button" onClick={() => setValue(original)}>
            Discard
          </button>
        </>
      );
    }
    render(<Host />);
    const box = screen.getByRole("textbox") as HTMLInputElement;
    await userEvent.type(box, ", b");
    expect(box.value).toBe("a, b");
    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(box.value).toBe("a");
  });
});

describe("select", () => {
  /*
   * A select is the one control here that can refuse a value by not offering it, and a Radix trigger
   * with no matching item renders blank. The server owns this vocabulary and the catalog only
   * mirrors it, so a value the mirror has not heard of is added rather than dropped: a row that
   * silently shows nothing is worse than a row that shows an unexpected word.
   */
  it("shows a value the catalog does not list, rather than rendering blank", () => {
    renderControl(entry({ kind: "select", options: ["nominatim", "none"] }), "photon");
    expect(screen.getByRole("combobox").textContent).toBe("photon");
  });

  it("offers the catalog's options", async () => {
    const emitted = renderControl(
      entry({ kind: "select", options: ["nominatim", "none"] }),
      "none",
    );
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: "nominatim" }));
    expect(emitted).toEqual(["nominatim"]);
  });
});
