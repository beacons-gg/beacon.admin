/**
 * `ServerRolesProvider`: each trusted server's role from its status read, and the quick-view server
 * held to "not an admin" while its first read is still in flight.
 */
import { ApiError } from "@beaconsgg/client-sdk";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServerRolesProvider, useServerRoles } from "../roles";
import { savedServer } from "./fixtures";

const A = savedServer("https://a.example");
const B = savedServer("https://b.example");
const C = savedServer("https://c.example");

const known = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
const reads = vi.hoisted(() => ({ byOrigin: {} as Record<string, unknown> }));
vi.mock("../ServersProvider", () => ({ useServers: () => known.value }));
vi.mock("../useAdminStatus", async (original) => ({
  ...(await original<typeof import("../useAdminStatus")>()),
  useAdminStatus: (origin: string) => reads.byOrigin[origin] ?? {},
}));

const denied = Object.assign(Object.create(ApiError.prototype), { status: 403 });

function Roles() {
  const { roleOf, notAdmin } = useServerRoles();
  return (
    <p>
      {[A, B, C].map((s) => `${s.origin}=${roleOf(s.origin)}`).join(" ")} | {notAdmin.join(",")}
    </p>
  );
}

describe("ServerRolesProvider", () => {
  it("reads each trusted server's role and probes no untrusted one", () => {
    known.value = {
      servers: [A, B, C],
      identityChanged: [],
      checking: [C.origin],
      preview: undefined,
    };
    reads.byOrigin = { [A.origin]: { data: {} }, [B.origin]: { error: denied } };
    render(
      <ServerRolesProvider>
        <Roles />
      </ServerRolesProvider>,
    );
    expect(screen.getByText(/a\.example=admin/).textContent).toBe(
      `${A.origin}=admin ${B.origin}=notAdmin ${C.origin}=unknown | ${B.origin}`,
    );
  });

  it("holds the quick-view server to not an admin until its first read lands", () => {
    known.value = { servers: [A, C], identityChanged: [], checking: [], preview: C.origin };
    reads.byOrigin = {};
    render(
      <ServerRolesProvider>
        <Roles />
      </ServerRolesProvider>,
    );
    expect(screen.getByText(/c\.example=notAdmin/)).toBeTruthy();
    expect(screen.getByText(/a\.example=unknown/)).toBeTruthy();
  });
});
