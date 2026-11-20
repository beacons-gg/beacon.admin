/**
 * The dashboard's fan-out and a server whose key changed: its status read is a signed admin
 * op, so it gets the reason in place of its card, and no read is attempted.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { savedServer, WALLET } from "../../servers/__tests__/fixtures";
import { Dashboard } from "../Dashboard";

const A = savedServer("https://a.example", { name: "Alpha" });
const B = savedServer("https://b.example", { name: "Bravo" });
const C = savedServer("https://c.example", { name: "Charlie" });

vi.mock("../../servers/ServersProvider", () => ({
  useServers: () => ({
    servers: [A, B, C],
    targets: [A, B, C],
    identityChanged: [A.origin],
    checking: [C.origin],
  }),
}));
vi.mock("@/features/wallet", () => ({ useWallet: () => ({ wallet: WALLET }) }));
const statusCard = vi.hoisted(() => vi.fn((_props: { server: { origin: string } }) => null));
vi.mock("../StatusCard", () => ({ StatusCard: statusCard }));

describe("Dashboard", () => {
  it("reads status only from servers checked this session and still under their pinned key", () => {
    render(<Dashboard />);
    expect(statusCard.mock.calls.map(([props]) => props.server.origin)).toEqual([B.origin]);
    expect(screen.getByText(/Alpha is now signing with a different key/)).toBeTruthy();
    expect(screen.getByText(/Checking Charlie's identity/)).toBeTruthy();
  });
});
