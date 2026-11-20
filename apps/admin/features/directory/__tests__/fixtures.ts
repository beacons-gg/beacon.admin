import { vi } from "vitest";

/** Shared fixtures for the directory suites. Not a `.test.ts`, so vitest does not collect it. */

/** A nonce as the directory issues one: a ULID. */
export const NONCE = "01JCZ8X8M6Q2W3E4R5T6Y7A8B9";

/** The directory's refusal of a listing that Beacon's hosting keeps listed. */
export const HOSTED = {
  ok: false,
  error: "hosted",
  message:
    "The hosting dashboard lists this server. Clear List on beacons.gg on the server's Settings tab to remove the listing.",
};

type Reply = [body: unknown, status: number];

/** A request the code under test sent, with its JSON body parsed. */
export interface SentRequest {
  url: string;
  method: string | undefined;
  credentials: RequestCredentials | undefined;
  body: unknown;
}

/**
 * Stub `fetch` to answer each request with the next of `replies`, and with a `404` once they run
 * out. A string body goes out as HTML, the way a proxy in front of the directory answers. Hands back
 * every request made, in order.
 */
export function directoryReplies(replies: Reply[]): () => SentRequest[] {
  const sent: SentRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      sent.push({
        url,
        method: init.method,
        credentials: init.credentials,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const [body, status] = replies[sent.length - 1] ?? [{ ok: false, error: "notFound" }, 404];
      const html = typeof body === "string";
      return Promise.resolve(
        new Response(html ? body : JSON.stringify(body), {
          status,
          headers: { "content-type": html ? "text/html" : "application/json" },
        }),
      );
    }),
  );
  return () => sent;
}
