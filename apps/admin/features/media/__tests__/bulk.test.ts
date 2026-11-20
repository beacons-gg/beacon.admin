import { describe, expect, it } from "vitest";
import { runBulk } from "../bulk";

describe("runBulk — bounded-concurrency bulk runner for media review/delete", () => {
  it("runs every item and tallies successes", async () => {
    const seen: number[] = [];
    const { ok, failed } = await runBulk([1, 2, 3, 4], async (n) => {
      seen.push(n);
    });
    expect(ok).toBe(4);
    expect(failed).toBe(0);
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });

  it("isolates failures: a rejected item is counted, the rest still run", async () => {
    const done: string[] = [];
    const { ok, failed } = await runBulk(["a", "boom", "c"], async (x) => {
      if (x === "boom") throw new Error("nope");
      done.push(x);
    });
    expect(ok).toBe(2);
    expect(failed).toBe(1);
    expect(done.sort()).toEqual(["a", "c"]);
  });

  it("never exceeds the concurrency cap", async () => {
    let inFlight = 0;
    let peak = 0;
    await runBulk(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve(); // yield so overlap is observable
        inFlight -= 1;
      },
      3,
    );
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles an empty selection without spawning workers", async () => {
    let calls = 0;
    const { ok, failed } = await runBulk([], async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    expect(ok).toBe(0);
    expect(failed).toBe(0);
  });
});
