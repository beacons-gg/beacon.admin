import { describe, expect, it } from "vitest";
import { mediaRoom } from "../mediaRoom";

describe("mediaRoom", () => {
  it("is undefined for a server without a limit", () => {
    expect(mediaRoom({ mediaBytes: 10 })).toBeUndefined();
  });

  it("gives the room left, and says when 80% or more is used", () => {
    expect(mediaRoom({ mediaBytes: 100, mediaLimitBytes: 500 })).toEqual({
      used: 100,
      limit: 500,
      room: 400,
      nearlyFull: false,
    });
    expect(mediaRoom({ mediaBytes: 400, mediaLimitBytes: 500 })?.nearlyFull).toBe(true);
  });

  it("says nothing of a server with media off, whose host gave it no room", () => {
    expect(mediaRoom({ mediaBytes: 0, mediaLimitBytes: 0 }, ["mailbox"])).toBeUndefined();
    expect(mediaRoom({ mediaBytes: 0, mediaLimitBytes: 0 }, ["media"])?.nearlyFull).toBe(true);
  });

  it("never gives negative room, for a server past its limit", () => {
    expect(mediaRoom({ mediaBytes: 600, mediaLimitBytes: 500 })).toMatchObject({
      room: 0,
      nearlyFull: true,
    });
  });
});
