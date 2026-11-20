import { verifyOp } from "@beaconsgg/identity";
import { opEnvelopeSchema } from "@beaconsgg/protocol-types";
import { expect, vi } from "vitest";

/** A locked server's refusal, as it answers with a 503. */
export const LOCKED = { ok: false, error: "writeLocked", message: "The server is locked." };

type Reply = [body: unknown, status: number];

/**
 * Stub `fetch` to answer each request with the next of `replies` (JSON body and status), and with
 * `otherwise` once they run out. Hands back every request the code under test made, in order.
 */
export function stubReplies(
  replies: Reply[],
  otherwise: Reply = [{ ok: true }, 200],
): () => { url: string; body: unknown }[] {
  const captured: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      captured.push({ url, body: JSON.parse(init.body as string) });
      const [response, status] = replies[captured.length - 1] ?? otherwise;
      return Promise.resolve(
        new Response(JSON.stringify(response), {
          status,
          // As a server sends it: the SDK reads a 5xx or 404 body only when it is JSON.
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return () => captured;
}

/**
 * Stub `fetch` with a fixed JSON reply, and hand back the request the code under test made.
 *
 * Shared because the signed-wrapper suites all need the same thing: assert the URL, then parse the
 * body as an `OpEnvelope` and check the op and params. `status` is here so the error paths can use
 * it too: an extraction that is less capable than the copies it replaces just leaves them in place.
 * Not a `.test.ts`, so `vitest.config.ts` does not collect it as a suite. Callers still need their
 * own `afterEach(() => vi.unstubAllGlobals())`.
 */
export function stubFetch(response: unknown, status = 200): () => { url: string; body: unknown } {
  const sent = stubReplies([], [response, status]);
  return () => sent().at(-1) as { url: string; body: unknown };
}

/**
 * The request a {@link stubFetch} saw, read as a signed envelope: fails unless the signature
 * verifies, then hands back what a signed-wrapper suite asserts on.
 */
export function signedRequest(get: () => { url: string; body: unknown }): {
  url: string;
  op: string;
  params: unknown;
} {
  const { url, body } = get();
  const env = opEnvelopeSchema.parse(body);
  expect(verifyOp(env, Date.now()).ok).toBe(true);
  return { url, op: env.op, params: env.params };
}
