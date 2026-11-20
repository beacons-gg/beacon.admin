"use client";

import { useState, type ComponentProps, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, copyText } from "@/lib/utils";

/**
 * The console's app-specific primitives (the ones shadcn doesn't cover): a titled `Panel`, a
 * labelled `Field`, inline `ErrorText`, a status-toned `ToneBadge`, and the copyable `Did` chip.
 * Everything else (Button, Input, Card, Badge, …) comes straight from `@/components/ui/*`.
 */

/**
 * A panel's kind or a list's heading: tracked mono capitals in the quiet ink. One string, so every
 * kicker in the console stays the same.
 */
export const KICKER = "font-mono text-[10.5px] font-medium tracking-[0.12em] text-ink-3 uppercase";

/** A screen's body under its title: the line above it and the console's page padding. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="border-t px-4 py-[18px] md:px-[26px]">{children}</div>;
}

/** A titled section built on shadcn Card — the common "labelled panel" shape across the console. */
export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Card>
      {title ? (
        <CardHeader>
          <CardTitle className={KICKER}>{title}</CardTitle>
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** A labelled form field — the label sits above its control. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const TAG_TONE = {
  neutral: "text-muted-foreground",
  ok: "text-status-ok",
  warn: "text-status-warn",
  error: "text-status-crit",
} as const;

/**
 * A state as a square and a word in mono, in its status color: the console's status tag, for the
 * semantic tones shadcn's Badge variants don't cover.
 */
export function ToneBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "error";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center gap-1.5 rounded-[4px] border border-line-2 px-1.5 py-px font-mono text-[11px] font-medium",
        TAG_TONE[tone],
      )}
    >
      <span className="size-[7px] shrink-0 bg-current" aria-hidden />
      {children}
    </span>
  );
}

/** How a durable background run's status reads as a {@link ToneBadge}. */
export const RUN_STATUS_TONE = {
  queued: "neutral",
  running: "warn",
  done: "ok",
  failed: "error",
} as const;

/**
 * A progress track. `ratio` runs 0 to 1. `trackClassName` adds to or overrides the track's classes;
 * the default track is `bg-muted`, so a bar on a muted surface has to pass a different one.
 */
export function ProgressBar({
  label,
  ratio,
  trackClassName,
}: {
  label: string;
  ratio: number;
  trackClassName?: string | undefined;
}) {
  const filled = Math.min(Math.max(ratio, 0), 1) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(filled)}
      className={cn("mt-1 h-1.5 overflow-hidden rounded-full bg-muted", trackClassName)}
    >
      <div className="h-full bg-primary transition-[width]" style={{ width: `${filled}%` }} />
    </div>
  );
}

/** Labelled facts, an optional heading above them. A row whose value is absent is left out. */
export function Facts({
  title,
  rows,
  className,
}: {
  title?: string | undefined;
  rows: [string, ReactNode | undefined][];
  className?: string | undefined;
}) {
  const present = rows.filter(([, value]) => value !== undefined && value !== null);
  if (present.length === 0) return null;
  return (
    <div>
      {title ? <h4 className={`${KICKER} mb-1`}>{title}</h4> : null}
      <dl className={cn("grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs", className)}>
        {present.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * ON or OFF in mono capitals: the word beside a switch and in a summary of one, in the control
 * colour when on. Spreads span props (`aria-hidden` beside a switch that announces its own state).
 */
export function StateWord({
  on,
  className,
  ...rest
}: { on: boolean } & Omit<ComponentProps<"span">, "children">) {
  return (
    <span
      {...rest}
      className={cn(
        "font-mono text-[11px] uppercase",
        on ? "text-control-on" : "text-muted-foreground",
        className,
      )}
    >
      {on ? "On" : "Off"}
    </span>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="mt-2 text-sm text-destructive">{children}</p> : null;
}

/**
 * A DID (or other long id) truncated for display — **click to copy the full value**. Falls back to
 * a prompt when the Clipboard API is unavailable (plain-http LAN is not a secure context).
 */
export function Did({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > 24 ? `${value.slice(0, 14)}…${value.slice(-6)}` : value;
  const copy = async () => {
    if (await copyText(value)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={`${value}\n(click to copy)`}
      className="cursor-pointer font-mono text-xs break-all text-muted-foreground hover:text-foreground"
    >
      {copied ? "copied ✓" : short}
    </button>
  );
}
