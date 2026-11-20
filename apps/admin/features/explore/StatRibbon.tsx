"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { mediaRoom } from "@/features/dashboard";
import { useAdminStatus, useSingleServer } from "@/features/servers";
import { formatBytes } from "@/lib/format";

function Hint({ children }: { children: React.ReactNode }) {
  return <div className="border-b px-4 py-2.5 text-xs text-ink-3">{children}</div>;
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warn" | undefined;
}) {
  return (
    <div className="flex flex-col gap-1 bg-background px-4 py-3">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-3 rounded-[3px] border-[1.5px] border-ink-3" aria-hidden />
        {label}
      </span>
      <span
        className={`tabular text-[22px] leading-tight font-medium tracking-[-0.03em] ${
          tone === "warn" ? "text-status-warn" : ""
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function StatRibbonLoaded({ origin }: { origin: string }) {
  const { data, error, isLoading } = useAdminStatus(origin);
  if (error)
    return <Hint>The server did not answer its status read. The console asks again shortly.</Hint>;
  if (isLoading || !data)
    return (
      <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5 bg-background px-4 py-3">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-5 w-12" />
          </div>
        ))}
      </div>
    );

  const c = data.counts;
  const room = mediaRoom(c, data.capabilities);
  return (
    <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-3 lg:grid-cols-5">
      <Tile label="Rooms" value={c.rooms.toLocaleString()} />
      <Tile label="Places" value={c.places.toLocaleString()} />
      <Tile
        label="Conflicts pending"
        value={c.conflictsPending}
        tone={c.conflictsPending > 0 ? "warn" : undefined}
      />
      {/* The wire field stays `snapshots`; the label follows the console's "runs" language. */}
      <Tile label="Runs" value={c.snapshots} />
      <Tile
        label="Media store"
        value={
          room
            ? `${formatBytes(c.mediaBytes)} of ${formatBytes(room.limit)}`
            : formatBytes(c.mediaBytes)
        }
        tone={room?.nearlyFull ? "warn" : undefined}
      />
    </div>
  );
}

/** Server health at a glance above the Explore hub: live `admin.status` for the active server. */
export function StatRibbon() {
  const gate = useSingleServer({
    server: "these are one server's live stats",
    wallet: "the status read is a signed request",
  });
  if (!gate.ok) return <Hint>{gate.refusal}</Hint>;
  return <StatRibbonLoaded origin={gate.server.origin} />;
}
