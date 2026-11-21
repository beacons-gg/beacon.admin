/**
 * The operator's PUBLIC profile: a display name + emoji
 * avatar published as the same self-signed `ProfileDoc` a phone publishes, so players'
 * attribution renderers resolve the organizer of an operator challenge like any other account
 * instead of a bare DID face.
 *
 * Multi-server and best-effort, the phone's stance: read every saved server's copy, believe
 * the best one (the SDK's `fetchBestProfile`, over the `@beaconsgg/identity` selection rule), bump its
 * version, carry everything but the face forward untouched, and publish the new doc to the
 * whole fleet. The doc is self-signed by the account root — the POST needs no envelope.
 */
import {
  authorizationFromProfileEntry,
  buildProfile,
  type Account,
  type Wallet,
} from "@beaconsgg/identity";
import type { ProfileDoc } from "@beaconsgg/protocol-types";
import { client, describeApiError, describeRefusal } from "@/lib/api";
import { avatarEmoji } from "@/lib/format";

/** The editor's prefill: the doc's public face as the two fields the dialog edits. */
export function publicFaceOf(doc: ProfileDoc | null): { displayName: string; avatarEmoji: string } {
  return { displayName: doc?.displayName ?? "", avatarEmoji: avatarEmoji(doc?.avatar) };
}

/** The fleet's best current face for `did` — the dialog's whole prefill in one call. */
export async function loadOperatorFace(
  origins: readonly string[],
  did: string,
): Promise<{ displayName: string; avatarEmoji: string }> {
  return publicFaceOf(await client.fetchBestProfile(origins, did));
}

export interface PublishOutcome {
  origin: string;
  ok: boolean;
  error?: string;
}

/**
 * The next doc to publish: version = current + 1, the public face replaced, everything else
 * (devices, revocations, handles, services, and any field this build does not own, such as one a
 * newer build added) carried forward untouched — this editor owns only the face. Device
 * authorizations rebuild through `authorizationFromProfileEntry`, the package's one spelling of the
 * doc's strip-inverse, so carried entries always re-verify. Pure given the current doc, so the
 * carry-forward is testable off the wire.
 */
export function nextOperatorDoc(
  account: Account,
  current: ProfileDoc | null,
  fields: { displayName: string; avatarEmoji: string },
): ProfileDoc {
  const displayName = fields.displayName.trim();
  const emoji = fields.avatarEmoji.trim();
  return buildProfile(account, {
    version: (current?.version ?? 0) + 1,
    supersedes: current,
    devices: (current?.devices ?? []).map((d) => ({
      did: d.key,
      auth: authorizationFromProfileEntry(current?.id ?? account.did, d),
    })),
    ...(current?.handles !== undefined && current.handles.length > 0
      ? { handles: current.handles }
      : {}),
    ...(current?.revoked !== undefined && current.revoked.length > 0
      ? { revoked: current.revoked }
      : {}),
    ...(current?.services !== undefined && current.services.length > 0
      ? { services: current.services }
      : {}),
    ...(displayName.length > 0 ? { displayName } : {}),
    ...(emoji.length > 0 ? { avatar: `emoji:${emoji}` } : {}),
  });
}

/**
 * Publish the operator's public face to every `origin`: one new doc (see {@link nextOperatorDoc})
 * posted fleet-wide so attribution resolves wherever a challenge lives. Deliberately RE-READS
 * the fleet right before the version bump — the dialog may have sat open while another session
 * edited, and rebasing on the freshest best copy is what stops this publish clobbering it.
 * Per-origin outcomes; a down or locked server is a row, not a failure.
 */
export async function publishOperatorProfile(
  origins: readonly string[],
  wallet: Wallet,
  fields: { displayName: string; avatarEmoji: string },
): Promise<PublishOutcome[]> {
  const did = wallet.account.did;
  const current = await client.fetchBestProfile(origins, did);
  const doc = nextOperatorDoc(wallet.account, current, fields);
  return Promise.all(
    origins.map(async (origin): Promise<PublishOutcome> => {
      try {
        const result = await client.publishProfile(origin, doc);
        // The SDK returns a refusal's code, and one the console words gets its sentence. A lock and a
        // fault throw instead, into the `catch`.
        const error = describeRefusal(result.error) ?? result.error;
        return { origin, ...result, ...(error !== undefined ? { error } : {}) };
      } catch (err) {
        return { origin, ok: false, error: describeApiError(err) };
      }
    }),
  );
}
