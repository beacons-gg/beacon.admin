import { describe, expect, it } from "vitest";
import { serverLabel } from "../label";

describe("serverLabel", () => {
  it("prefers the operator's display name", () => {
    expect(serverLabel({ host: "h.example", name: "Northwind" })).toBe("Northwind");
  });

  it("falls back to the host when the descriptor carried no name", () => {
    expect(serverLabel({ host: "h.example" })).toBe("h.example");
    expect(serverLabel({ host: "h.example", name: undefined })).toBe("h.example");
  });

  /*
   * `serverDescriptorSchema.name` is `z.string().optional()` with no `.min(1)`, so a descriptor with
   * `"name": ""` verifies and is pinned. `name ?? host` renders nothing at all for it, which is worst
   * where the label is the only thing identifying the server on screen.
   */
  it("falls back for a name that is present but blank", () => {
    expect(serverLabel({ host: "h.example", name: "" })).toBe("h.example");
    expect(serverLabel({ host: "h.example", name: "   " })).toBe("h.example");
  });
});
