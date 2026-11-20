/** The inspect card's room read: the fields it shows, and a gone room as `null`. */
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { getRoom } from "../api";

const getJson = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getJson,
}));

const PLACER = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";

describe("getRoom", () => {
  it("reads the room's game, name, placer and per-op games, whatever else it carries", async () => {
    getJson.mockResolvedValueOnce({
      id: "r@a.example",
      game: "game-a",
      placedBy: PLACER,
      state: { contents: [] },
      policy: { ops: { add: { role: "public", games: ["game-b"], when: {} } }, lifecycle: {} },
    });
    await expect(getRoom("https://a.example", "r@a.example")).resolves.toEqual({
      game: "game-a",
      placedBy: PLACER,
      policy: { ops: { add: { games: ["game-b"] } } },
      state: {},
    });
    expect(getJson).toHaveBeenCalledWith("https://a.example", "/rooms/r%40a.example");
  });

  it("reads the claim ledger, and still shows the room when its state is unreadable", async () => {
    const ledger = { phase: "unlocked", contributors: { a: ["1"] }, claimed: ["a"] };
    const policy = { ops: { claim: { phase: "unlocked" } } };
    getJson.mockResolvedValueOnce({ placedBy: PLACER, policy, state: ledger });
    await expect(getRoom("https://a.example", "r@a.example")).resolves.toEqual({
      placedBy: PLACER,
      policy,
      state: ledger,
    });
    getJson.mockResolvedValueOnce({ placedBy: PLACER, policy, state: { claimed: "a" } });
    await expect(getRoom("https://a.example", "r@a.example")).resolves.toEqual({
      placedBy: PLACER,
      policy,
    });
  });

  it("is null for a room the server no longer has, and throws on any other failure", async () => {
    getJson.mockRejectedValueOnce(new ApiError(404, "unknownRoom"));
    await expect(getRoom("https://a.example", "r@a.example")).resolves.toBeNull();
    getJson.mockResolvedValueOnce({ game: "game-a" });
    await expect(getRoom("https://a.example", "r@a.example")).rejects.toThrow();
  });
});
