import { ApiError } from "@beaconsgg/client-sdk";
import { describe, expect, it, vi } from "vitest";
import { WALLET } from "./fixtures";

const status = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("swr", () => ({ mutate: vi.fn() }));
vi.mock("../useAdminStatus", async (original) => ({
  ...(await original<typeof import("../useAdminStatus")>()),
  fetchAdminStatus: status.fetch,
}));

const { probeRole, roleFrom } = await import("../role");
const { isNotAdminError } = await import("../useAdminStatus");

/** An `ApiError` with a status, built the way the SDK's own constructor takes one. */
const apiError = (code: number) =>
  Object.assign(Object.create(ApiError.prototype), { status: code });

describe("isNotAdminError", () => {
  it("reads a 403 (not on BEACON_ADMINS) and a 404 (no admin surface) as not an admin", () => {
    expect(isNotAdminError(apiError(403))).toBe(true);
    expect(isNotAdminError(apiError(404))).toBe(true);
  });

  it("does not read a fault or a network failure as a role", () => {
    expect(isNotAdminError(apiError(503))).toBe(false);
    expect(isNotAdminError(new Error("offline"))).toBe(false);
  });
});

describe("roleFrom", () => {
  const data = {} as never;
  it("is admin once a status read answers", () => {
    expect(roleFrom({ data })).toBe("admin");
  });
  it("is unknown while nothing has answered", () => {
    expect(roleFrom({})).toBe("unknown");
  });
  it("trusts a refusal over the data SWR keeps from before it", () => {
    expect(roleFrom({ data, error: apiError(403) })).toBe("notAdmin");
  });
  it("does not drop an admin to a visitor over a server that is down", () => {
    expect(roleFrom({ data, error: apiError(503) })).toBe("unknown");
  });
});

describe("probeRole", () => {
  it("asks the server once, with the wallet", async () => {
    status.fetch.mockResolvedValueOnce({});
    await expect(probeRole("https://a.example", WALLET as never)).resolves.toBe("admin");
    expect(status.fetch).toHaveBeenCalledWith("https://a.example", WALLET);
  });

  it("answers notAdmin for a refusal and unknown for anything else", async () => {
    status.fetch.mockRejectedValueOnce(apiError(403));
    await expect(probeRole("https://a.example", WALLET as never)).resolves.toBe("notAdmin");
    status.fetch.mockRejectedValueOnce(new Error("offline"));
    await expect(probeRole("https://a.example", WALLET as never)).resolves.toBe("unknown");
  });
});
