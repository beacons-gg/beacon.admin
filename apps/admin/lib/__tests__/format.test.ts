import { describe, expect, it } from "vitest";
import { formatRunDuration } from "../format";

describe("formatRunDuration", () => {
  const startedAt = "2026-11-08T10:00:01.000Z";

  it("reads the durable stamps", () => {
    expect(formatRunDuration({ startedAt, finishedAt: "2026-11-08T10:00:19.000Z" })).toBe("18s");
    expect(formatRunDuration({ startedAt, finishedAt: "2026-11-08T10:04:03.000Z" })).toBe("4m02s");
  });

  it("is nothing for a run that has not finished, or whose clock went backwards", () => {
    expect(formatRunDuration({ startedAt })).toBeUndefined();
    expect(
      formatRunDuration({ startedAt, finishedAt: "2026-11-08T09:00:00.000Z" }),
    ).toBeUndefined();
  });
});
