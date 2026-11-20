"use client";

import { LockIcon } from "lucide-react";
import { serverLabel, useAdminStatus, useSingleServer, type SavedServer } from "@/features/servers";
import { LockControl } from "./LockControl";

/**
 * The strip on every page while the selected server is locked, since a restored server starts locked
 * and takes no writes until an admin unlocks it.
 *
 * The state is the console's `admin.status` poll, which this keeps running on every page. It
 * sits behind the same gate as any signed read: with the wallet locked, or the server's identity not
 * yet checked, no status can be asked for, and the strip stays away rather than guessing. The gate's
 * sentences are unused here; there is nothing to say on a page that is not about the lock.
 */
export function ServerLockBanner() {
  const gate = useSingleServer({
    server: "the lock belongs to one server",
    wallet: "its state is a signed read",
  });
  if (!gate.ok) return null;
  // Keyed so a write in flight on one server cannot leave its busy state on the next one.
  return <Notice key={gate.server.origin} server={gate.server} />;
}

function Notice({ server }: { server: SavedServer }) {
  const { data, error } = useAdminStatus(server.origin);
  // A failed refresh leaves old data behind, which is no basis for saying the server is locked.
  if (error || data?.writeLocked !== true) return null;

  return (
    <div
      role="alert"
      className="sticky top-[52px] z-20 border-b border-status-warn/40 bg-background"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-status-warn/10 px-4 py-2 md:px-[26px]">
        <LockIcon className="size-3.5 shrink-0 text-status-warn" aria-hidden />
        <p className="min-w-0 flex-1 basis-60 text-[13px]">
          <span className="font-medium text-status-warn">{serverLabel(server)} is locked.</span>{" "}
          Players cannot make changes, and most console screens are refused until it is unlocked.
        </p>
        <LockControl server={server} locked />
      </div>
    </div>
  );
}
