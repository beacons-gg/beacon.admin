import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * What a rendered suite needs from the environment, in one place.
 *
 * Testing Library unmounts between tests by itself only when `afterEach` is a global. This repo
 * imports its test functions rather than injecting them (`globals` is off everywhere), so the hook
 * is registered here instead. Without it every render stacks in the same document and the queries,
 * which search the whole body, start matching the previous test's markup.
 */
afterEach(cleanup);

/*
 * jsdom implements no layout and no pointer capture, and Radix's popup primitives use both: a Select
 * trigger captures the pointer on `pointerdown`, and its content scrolls the active item into view.
 * Each is a gap in jsdom rather than a behaviour worth faking, so each stands in with the smallest
 * thing that lets the component get on with it. Without the first line a `Select` under test throws
 * `target.hasPointerCapture is not a function` before any assertion runs.
 *
 * **Exactly the two the suite needs.** `setPointerCapture`, `releasePointerCapture` and
 * `ResizeObserver` were here too and were removed after checking, one at a time, that nothing failed
 * without them: a stub nothing calls is a claim about the environment that no test is holding up.
 * The next one belongs here when a test needs it, and the failure that asks for it is legible.
 *
 * `??=` rather than plain assignment, so the day jsdom implements one, the implementation wins. This
 * is not a licence to assert on anything needing a real box model, such as which way a menu flips
 * near the viewport edge. That is a browser's job and no stub here makes it answerable.
 */
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.scrollIntoView ??= () => {};
