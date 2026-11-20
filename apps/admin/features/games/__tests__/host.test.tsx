/**
 * The host a plugin screen gets: its writes are its game's, so its client signs as the plugin's slug,
 * while the console's own client names no game.
 */
import { useAdminHost } from "@beaconsgg/admin-plugin";
import { createWallet } from "@beaconsgg/identity";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { client } from "@/lib/api";
import { PluginHost } from "../host";

const WALLET = createWallet();

function Probe({ seen }: { seen: { game?: string | undefined }[] }) {
  seen.push(useAdminHost().client.sign(WALLET, { op: "place", params: {} }));
  return null;
}

describe("PluginHost", () => {
  it("hands a plugin a client that signs as its game, and leaves the console's own gameless", () => {
    const seen: { game?: string | undefined }[] = [];
    render(
      <PluginHost game="some-game">
        <Probe seen={seen} />
      </PluginHost>,
    );
    expect(seen[0]?.game).toBe("some-game");
    expect(client.sign(WALLET, { op: "place", params: {} })).not.toHaveProperty("game");
  });
});
