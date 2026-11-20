import type { SecureKeyStore } from "@beaconsgg/client-sdk";
import type { ZodType } from "zod";

/**
 * Schema-validated localStorage (the console's only persistence: the Next
 * server holds nothing). A missing key, JSON garbage, or a shape mismatch all read as `undefined`
 * so callers never branch on parse errors; SSR (no `window`) reads as absent too.
 */
export function loadJson<T>(key: string, schema: ZodType<T>): T | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

/**
 * This browser's storage as the SDK's `SecureKeyStore`, for the operator wallet's vault. Not secure
 * storage (nothing in a browser is), which is why the vault keeps only a passphrase-encrypted phrase
 * in it. SSR (no `window`) reads as absent and writes nothing, like the functions above.
 */
const local = (): Storage | undefined =>
  typeof window === "undefined" ? undefined : window.localStorage;

export const localKeyStore: SecureKeyStore = {
  getItem: (key) => Promise.resolve(local()?.getItem(key) ?? null),
  setItem: (key, value) => Promise.resolve(local()?.setItem(key, value)),
  deleteItem: (key) => Promise.resolve(local()?.removeItem(key)),
};
