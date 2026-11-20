import { createWallet, verifyOp } from "@beaconsgg/identity";
import { opEnvelopeSchema } from "@beaconsgg/protocol-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubFetch } from "@/lib/__tests__/fetchStub";
import { settingsGet, settingsReset, settingsSet } from "../api";
import { setting } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

const report = { ok: true, settings: [setting()] };
const wallet = createWallet();

describe("settings feature api", () => {
  it("signs admin.settings.get with an empty body and returns the parsed report", async () => {
    const get = stubFetch(report);

    const rows = await settingsGet("https://s.example", wallet);
    expect(rows.map((r) => r.key)).toEqual(["mailboxTtlSeconds"]);

    const { url, body } = get();
    expect(url).toBe("https://s.example/admin/settings/get");
    const env = opEnvelopeSchema.parse(body);
    expect(env.op).toBe("admin.settings.get");
    expect(env.params).toEqual({});
    expect(verifyOp(env, Date.now()).ok).toBe(true);
  });

  /*
   * `null` is how "clear this to no value" travels, and it has to survive the wrapper untouched: the
   * server reads it as a distinct instruction from a reset, and JSON has no other spelling for it.
   */
  it("sends a multi-key patch in one signed write, nulls intact", async () => {
    const get = stubFetch(report);

    await settingsSet(
      "https://s.example",
      wallet,
      { placesEnabled: false, placesContributionsEnabled: false, contact: null },
      "shutting places down",
    );

    const { url, body } = get();
    expect(url).toBe("https://s.example/admin/settings/set");
    const env = opEnvelopeSchema.parse(body);
    expect(env.op).toBe("admin.settings.set");
    expect(env.params).toEqual({
      settings: { placesEnabled: false, placesContributionsEnabled: false, contact: null },
      reason: "shutting places down",
    });
  });

  it("omits an empty reason rather than sending one the schema refuses", async () => {
    const get = stubFetch(report);
    await settingsSet("https://s.example", wallet, { mailboxEnabled: true });
    expect((get().body as { params: Record<string, unknown> }).params).toEqual({
      settings: { mailboxEnabled: true },
    });
  });

  it("signs admin.settings.reset with the keys to hand back", async () => {
    const get = stubFetch(report);

    await settingsReset("https://s.example", wallet, ["mailboxTtlSeconds"]);
    const { url, body } = get();
    expect(url).toBe("https://s.example/admin/settings/reset");
    const env = opEnvelopeSchema.parse(body);
    expect(env.op).toBe("admin.settings.reset");
    expect(env.params).toEqual({ keys: ["mailboxTtlSeconds"] });
  });

  /* All three answer with the whole configuration, so all three parse the same way. */
  it("keeps reading a row a newer server has grown a field on", async () => {
    stubFetch({ ok: true, settings: [{ ...setting(), unit: "seconds" }] });
    const rows = await settingsGet("https://s.example", wallet);
    expect(rows.map((r) => r.key)).toEqual(["mailboxTtlSeconds"]);
    expect(rows[0]).not.toHaveProperty("unit"); // dropped, not fatal
  });

  it("refuses a reply that is not the configuration, rather than casting it", async () => {
    stubFetch({ ok: true, settings: [{ key: "x" }] });
    await expect(settingsGet("https://s.example", wallet)).rejects.toThrow();
  });
});
