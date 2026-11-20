import {
  authorizeDevice,
  buildProfile,
  createDevice,
  createWallet,
  ProfileTooLargeError,
  signUtf8,
  verifyProfile,
} from "@beaconsgg/identity";
import { canonicalJson, MAX_PROFILE_BYTES, type ProfileDoc } from "@beaconsgg/protocol-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadOperatorFace,
  nextOperatorDoc,
  publicFaceOf,
  publishOperatorProfile,
} from "../profileApi";
import { WRITE_LOCKED } from "@/lib/api";
import { LOCKED } from "@/lib/__tests__/fetchStub";

// The selection rule (`bestVerifiedProfile`) is tested where it lives, in @beaconsgg/identity.

describe("publicFaceOf — the editor's prefill", () => {
  it("reads the name and unwraps the emoji scheme; empty when absent", () => {
    const wallet = createWallet();
    const doc = buildProfile(wallet.account, {
      version: 1,
      devices: [],
      displayName: "North",
      avatar: "emoji:🦊",
    });
    expect(publicFaceOf(doc)).toEqual({ displayName: "North", avatarEmoji: "🦊" });
    expect(publicFaceOf(null)).toEqual({ displayName: "", avatarEmoji: "" });
  });
});

describe("nextOperatorDoc — the carry-forward publish", () => {
  it("bumps the version, replaces the face, and carries devices + handles forward so the doc still verifies", () => {
    const wallet = createWallet();
    const device = createDevice();
    const current = buildProfile(wallet.account, {
      version: 3,
      devices: [{ did: device.did, auth: authorizeDevice(wallet.account, device.did) }],
      handles: ["north"],
      displayName: "Old name",
    });
    const next = nextOperatorDoc(wallet.account, current, {
      displayName: "North Control",
      avatarEmoji: "🦊",
    });
    expect(next.version).toBe(4);
    expect(next.displayName).toBe("North Control");
    expect(next.avatar).toBe("emoji:🦊");
    expect(next.devices.map((d) => d.key)).toEqual([device.did]);
    expect(next.handles).toEqual(["north"]); // carried, not silently dropped
    // The rebuilt device authorizations must re-verify — the whole point of the carry.
    expect(verifyProfile(next)).toBe(true);
  });

  it("keeps a field a newer build published, which this console does not know", () => {
    const wallet = createWallet();
    const { proof: _p, ...body } = buildProfile(wallet.account, { version: 3, devices: [] });
    const newer = { ...body, pronouns: "they/them" };
    const sig = signUtf8(canonicalJson(newer), wallet.account.root.privateKey);
    const current = {
      ...newer,
      proof: { type: "Ed25519", key: wallet.account.did, sig },
    } as ProfileDoc;

    const next = nextOperatorDoc(wallet.account, current, {
      displayName: "North",
      avatarEmoji: "",
    });
    expect(next).toMatchObject({ version: 4, displayName: "North", pronouns: "they/them" });
    expect(verifyProfile(JSON.parse(JSON.stringify(next)))).toBe(true);
  });

  it("a first publish starts at version 1 with no devices; empty fields stay absent", () => {
    const wallet = createWallet();
    const next = nextOperatorDoc(wallet.account, null, { displayName: "  ", avatarEmoji: "" });
    expect(next.version).toBe(1);
    expect(next.displayName).toBeUndefined();
    expect(next.avatar).toBeUndefined();
    expect(verifyProfile(next)).toBe(true);
  });

  it("refuses to build a doc over the size cap rather than send it", () => {
    const wallet = createWallet();
    const fields = { displayName: "x".repeat(MAX_PROFILE_BYTES), avatarEmoji: "" };
    expect(() => nextOperatorDoc(wallet.account, null, fields)).toThrow(ProfileTooLargeError);
  });
});

describe("the fleet: reading every server's copy and publishing to each", () => {
  afterEach(() => vi.unstubAllGlobals());

  const A = "https://a.example";
  const B = "https://b.example";

  const JSON_TYPE = { "content-type": "application/json" };

  /**
   * A has no copy (404); B holds version 3 and answers a publish with `onBPublish` (a stale
   * refusal by default). Records every POST as [origin, doc].
   */
  function fleet(
    wallet: ReturnType<typeof createWallet>,
    onBPublish = () =>
      new Response(JSON.stringify({ ok: false, error: "stale", message: "older than the copy" }), {
        status: 409,
        headers: JSON_TYPE,
      }),
  ) {
    const onB = buildProfile(wallet.account, { version: 3, devices: [], displayName: "North" });
    const posted: [string, ProfileDoc][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const origin = new URL(url).origin;
        if (init?.method === "POST") {
          posted.push([origin, JSON.parse(init.body as string) as ProfileDoc]);
          return Promise.resolve(
            origin === A ? new Response(JSON.stringify({ ok: true })) : onBPublish(),
          );
        }
        return Promise.resolve(
          origin === B
            ? new Response(JSON.stringify(onB))
            : new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
        );
      }),
    );
    return posted;
  }

  /* A locked server answers 503 `writeLocked`; its row says so in the console's words. */
  it("says a locked server is locked", async () => {
    const wallet = createWallet();
    fleet(wallet, () => new Response(JSON.stringify(LOCKED), { status: 503, headers: JSON_TYPE }));
    const outcomes = await publishOperatorProfile([A, B], wallet, {
      displayName: "South",
      avatarEmoji: "",
    });
    expect(outcomes).toContainEqual({ origin: B, ok: false, error: WRITE_LOCKED });
  });

  /* A fault is no answer from the server, so its row gives the status and not a code. */
  it("says a server fault in the console's words", async () => {
    const wallet = createWallet();
    fleet(wallet, () => new Response("<html>Bad gateway</html>", { status: 502 }));
    const outcomes = await publishOperatorProfile([A, B], wallet, {
      displayName: "South",
      avatarEmoji: "",
    });
    expect(outcomes).toContainEqual({ origin: B, ok: false, error: "Server error 502." });
  });

  it("prefills from the best copy across the fleet", async () => {
    const wallet = createWallet();
    fleet(wallet);
    await expect(loadOperatorFace([A, B], wallet.account.did)).resolves.toEqual({
      displayName: "North",
      avatarEmoji: "",
    });
  });

  it("publishes the next version to every server, one outcome per server", async () => {
    const wallet = createWallet();
    const posted = fleet(wallet);
    const outcomes = await publishOperatorProfile([A, B], wallet, {
      displayName: "South",
      avatarEmoji: "",
    });
    expect(outcomes).toEqual([
      { origin: A, ok: true },
      { origin: B, ok: false, error: "stale" },
    ]);
    expect(posted.map(([origin]) => origin).sort()).toEqual([A, B]);
    for (const [, doc] of posted) {
      expect(doc.version).toBe(4); // B's copy was read first, and the new doc supersedes it
      expect(doc.displayName).toBe("South");
    }
  });
});
