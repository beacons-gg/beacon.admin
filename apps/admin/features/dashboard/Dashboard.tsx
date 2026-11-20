"use client";

import {
  GateNotice,
  trustRefusal,
  useAnyServer,
  useServerRoles,
  useServers,
} from "@/features/servers";
import { StatusCard, VisitorCard } from "./StatusCard";

/**
 * The pane of glass: one status card per target server (the active one, or all of them). Fans out
 * rather than working on one box, so it takes the `useAnyServer` half of the shared gate: it needs
 * the wallet and at least one saved server, and not a chosen one. A server whose identity changed,
 * or hasn't been checked yet this session, gets the reason in place of its card: its status read is
 * a signed admin request, and none goes to it. A server the wallet is not an admin of shows what its
 * signed descriptor says instead, since its status is for its admins.
 */
export function Dashboard() {
  const servers = useServers();
  const { roleOf } = useServerRoles();
  const gate = useAnyServer({ wallet: "every status read is a signed request" });
  if (!gate.ok) return <GateNotice>{gate.refusal}</GateNotice>;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {servers.targets.map((server) => {
        const untrusted = trustRefusal(server, servers);
        return untrusted !== undefined ? (
          <GateNotice key={server.origin}>{untrusted}</GateNotice>
        ) : roleOf(server.origin) === "notAdmin" ? (
          <VisitorCard key={server.origin} server={server} />
        ) : (
          <StatusCard key={server.origin} server={server} />
        );
      })}
    </div>
  );
}
