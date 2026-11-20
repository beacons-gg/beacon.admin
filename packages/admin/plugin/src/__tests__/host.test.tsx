import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminHostContext, useAdminHost, type AdminHost } from "../host";

function Probe() {
  return <span>{typeof useAdminHost().copyText}</span>;
}

describe("useAdminHost", () => {
  it("reads the host the console provides", () => {
    const host = { copyText: async () => true } as unknown as AdminHost;
    const html = renderToString(
      <AdminHostContext.Provider value={host}>
        <Probe />
      </AdminHostContext.Provider>,
    );
    expect(html).toContain("function");
  });

  it("throws outside the console's provider, rather than handing a plugin nothing", () => {
    expect(() => renderToString(<Probe />)).toThrow(/outside the console's host/);
  });
});
