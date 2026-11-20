import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class lists and resolve Tailwind conflicts (the shadcn `cn` helper). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** The set with `key` added, or removed when it was there. */
export function toggled<T>(set: ReadonlySet<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Copy `value` to the clipboard, with the console's one fallback: a prompt when the Clipboard
 * API is unavailable (plain-http LAN is not a secure context). Returns whether the silent copy
 * landed — callers toast only on `true` (the prompt IS the feedback otherwise).
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    window.prompt("Copy the full value:", value);
    return false;
  }
}
