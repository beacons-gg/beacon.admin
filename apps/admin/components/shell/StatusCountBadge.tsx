"use client";

import type { AdminStatus } from "@beaconsgg/protocol-types";
import { SidebarMenuBadge } from "@/components/ui/sidebar";
import { useAdminStatus, useSingleServer } from "@/features/servers";

/**
 * A nav item's badge: one of the selected server's `admin.status` counts, such as the requests to
 * join waiting on Members. It reads the status poll the lock banner already keeps running, behind
 * the same gate, so nothing shows while the wallet is locked, the server's identity is unchecked or
 * all servers are in scope. A zero shows nothing.
 */
export function StatusCountBadge({ count }: { count: keyof AdminStatus["counts"] }) {
  const gate = useSingleServer({
    server: "a count belongs to one server",
    wallet: "its count is a signed read",
  });
  return gate.ok ? <Count origin={gate.server.origin} count={count} /> : null;
}

function Count({ origin, count }: { origin: string; count: keyof AdminStatus["counts"] }) {
  const { data } = useAdminStatus(origin);
  const value = data?.counts[count] ?? 0;
  if (value === 0) return null;
  return (
    <SidebarMenuBadge className="font-mono text-[11px] text-status-warn">{value}</SidebarMenuBadge>
  );
}
