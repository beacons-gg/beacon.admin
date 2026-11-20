"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { ToneBadge } from "@/components/primitives";
import { Skeleton } from "@/components/ui/skeleton";
import { describeApiError } from "@/lib/api";
import { formatBytes, formatUptime } from "@/lib/format";
import { LockControl } from "@/features/lock";
import { serverLabel, useAdminStatus, type SavedServer } from "@/features/servers";
import { mediaRoom } from "./mediaRoom";

/** Renames only — the render falls back to the raw key for everything else. */
const COUNT_LABELS: Record<string, string> = {
  placesRetired: "retired",
  conflictsPending: "conflicts",
  mediaObjects: "media",
  mediaBytes: "media bytes",
  mediaLimitBytes: "media limit",
  mediaUnreviewed: "unreviewed",
  accessPending: "to join",
};

/** The counts that are sizes, shown as bytes. */
const BYTES = new Set(["mediaBytes", "mediaLimitBytes"]);

/** The counts that are work waiting for the operator: the only ones a colour can mean something on. */
const WAITING = new Set(["conflictsPending", "mediaUnreviewed", "accessPending"]);

/** A coverage list as words: the empty prefix is everywhere. */
const formatCoverage = (coverage: readonly string[]) =>
  coverage.map((c) => (c === "" ? "everywhere" : c)).join(", ");

/** One figure in the card's grid: its label above its value. */
function Figure({ label, value, warn }: { label: string; value: string; warn: boolean }) {
  return (
    <div className="min-w-0 border-r border-b px-4 py-3">
      <dt className="truncate text-[11.5px] text-ink-3">{label}</dt>
      <dd
        className={`tabular mt-1 truncate text-xl font-medium tracking-[-0.02em] ${warn ? "text-status-warn" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** A card's heading: the server's name, and its origin as a link to its home page. */
function CardHead({ server, children }: { server: SavedServer; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3.5 pb-3">
      <div className="min-w-0">
        <h3 className="truncate text-[14px] font-semibold">{serverLabel(server)}</h3>
        <a
          href={server.origin}
          target="_blank"
          rel="noreferrer"
          title="Open the server's home page in a new tab"
          className="block truncate font-mono text-[11.5px] text-ink-3 underline-offset-2 hover:text-foreground hover:underline"
        >
          {server.origin}
        </a>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}

/**
 * A server the wallet is not an admin of: what its signed descriptor says, which anyone may read, and
 * no admin controls. Its status read is refused, so there is nothing live to show.
 */
export function VisitorCard({ server }: { server: SavedServer }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <CardHead server={server}>
        <ToneBadge>not an admin</ToneBadge>
      </CardHead>
      <div className="flex flex-wrap gap-1.5 px-4 pb-3.5">
        {server.capabilities.map((c) => (
          <Badge key={c} variant="outline">
            {c}
          </Badge>
        ))}
      </div>
      <p className="border-t px-4 py-3 text-[13px] text-muted-foreground">
        Live status and counts are for this server&apos;s admins. To manage it, its operator adds
        your DID to the server&apos;s BEACON_ADMINS.
      </p>
      <p className="border-t px-4 py-2.5 font-mono text-[11.5px] text-ink-3">
        coverage {formatCoverage(server.coverage)}
      </p>
    </section>
  );
}

/** One server's `admin.status` card: identity facts, live uptime, and the operational counts. */
export function StatusCard({ server }: { server: SavedServer }) {
  const { data, error, isLoading } = useAdminStatus(server.origin);
  const room = data ? mediaRoom(data.counts, data.capabilities) : undefined;

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <CardHead server={server}>
        {/* The error first: SWR keeps the last good data through a failed refresh, and a server
              that stopped answering must not still read as up. */}
        {error ? (
          <ToneBadge tone="error">error</ToneBadge>
        ) : data ? (
          <>
            {data.writeLocked ? <ToneBadge tone="warn">locked</ToneBadge> : null}
            <ToneBadge tone="ok">up {formatUptime(data.startedAt)}</ToneBadge>
            {/* A server too old to report the lock has no lock to set. */}
            {data.writeLocked === undefined ? null : (
              <LockControl server={server} locked={data.writeLocked} />
            )}
          </>
        ) : null}
      </CardHead>
      {isLoading ? (
        <div className="space-y-3 px-4 pb-4">
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-14" />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-md" />
            ))}
          </div>
        </div>
      ) : null}
      {error ? <p className="px-4 pb-4 text-destructive">{describeApiError(error)}</p> : null}
      {data ? (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 pb-3.5">
            <Badge>v{data.version}</Badge>
            <Badge variant="outline">{data.accessLevel}</Badge>
            {data.capabilities.map((c) => (
              <Badge key={c} variant="outline">
                {c}
              </Badge>
            ))}
            {data.counts.conflictsPending > 0 ? (
              <ToneBadge tone="warn">{data.counts.conflictsPending} conflicts pending</ToneBadge>
            ) : null}
            {(data.counts.accessPending ?? 0) > 0 ? (
              <ToneBadge tone="warn">
                {data.counts.accessPending}{" "}
                {data.counts.accessPending === 1 ? "request" : "requests"} to join
              </ToneBadge>
            ) : null}
            {data.counts.mediaUnreviewed > 0 ? (
              <ToneBadge tone="warn">{data.counts.mediaUnreviewed} media to review</ToneBadge>
            ) : null}
            {room?.nearlyFull ? (
              <ToneBadge tone="warn">
                media {room.room > 0 ? `${formatBytes(room.room)} left` : "full"}
              </ToneBadge>
            ) : null}
          </div>
          <dl className="-mr-px -mb-px grid grid-cols-3 border-t sm:grid-cols-4">
            {/* Optional counts (a limit the server does not set) are absent, not zero. */}
            {Object.entries(data.counts).flatMap(([key, value]) =>
              value === undefined
                ? []
                : [
                    <Figure
                      key={key}
                      label={COUNT_LABELS[key] ?? key}
                      value={BYTES.has(key) ? formatBytes(value) : value.toLocaleString()}
                      warn={
                        (WAITING.has(key) && value > 0) ||
                        (key === "mediaBytes" && !!room?.nearlyFull)
                      }
                    />,
                  ],
            )}
          </dl>
          <p className="border-t px-4 py-2.5 font-mono text-[11.5px] text-ink-3">
            coverage {formatCoverage(data.coverage)}
          </p>
        </>
      ) : null}
    </section>
  );
}
