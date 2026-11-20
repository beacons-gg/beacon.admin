/** One server's map answers: each read fails on its own, so a refused places read keeps the rooms. */
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { fetchServerMapData } from "../useMapData";

const getJson = vi.hoisted(() => vi.fn());
const queryPlaces = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getJson,
}));
vi.mock("@/features/places", () => ({ queryPlaces }));

const server = { origin: "https://a.example", capabilities: ["places"] };
const discovery = { coveredBy: "c2", rooms: [], scouts: [] };
const place = { unique: "p1" };

describe("fetchServerMapData", () => {
  it("returns a server's discovery and places", async () => {
    getJson.mockResolvedValueOnce(discovery);
    queryPlaces.mockResolvedValueOnce({ places: [place] });
    await expect(fetchServerMapData(server, ["c2"], [])).resolves.toMatchObject({
      origin: server.origin,
      places: [place],
    });
    // A capped page spread over the view, not the lowest ids, which after an import fill one corner.
    expect(queryPlaces).toHaveBeenLastCalledWith(server.origin, ["c2"], [], { spread: true });
  });

  it("keeps the rooms and scouts when the places read is refused, as a too-wide view is", async () => {
    getJson.mockResolvedValueOnce(discovery);
    queryPlaces.mockRejectedValueOnce(new ApiError(400, "cells must be at least precision 4"));
    const got = await fetchServerMapData(server, ["c2"], []);
    expect(got).toMatchObject({ origin: server.origin, places: [] });
    expect(got?.discovery.coveredBy).toBe("c2");
  });

  it("drops the server when its discovery fails", async () => {
    getJson.mockRejectedValueOnce(new ApiError(503, "down"));
    queryPlaces.mockResolvedValueOnce({ places: [place] });
    await expect(fetchServerMapData(server, ["c2"], [])).resolves.toBeUndefined();
  });
});
