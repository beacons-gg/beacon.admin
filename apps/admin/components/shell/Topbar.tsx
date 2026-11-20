"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { serverLabel, useServers } from "@/features/servers";
import { titleForPath } from "./nav";

/**
 * The header bar of every screen: where you are, as crumbs (the
 * scope, then the screen). The scope itself is chosen in the sidebar.
 */
export function Topbar() {
  const pathname = usePathname();
  const { activeServer, servers } = useServers();

  return (
    <header className="sticky top-0 z-20 flex h-[52px] shrink-0 items-center gap-2.5 rounded-t-[10px] border-b bg-background/90 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1 text-ink-3 hover:text-foreground" />
      <nav aria-label="Where you are" className="flex min-w-0 items-center gap-2.5">
        <span className="truncate text-muted-foreground">
          {activeServer ? (
            <span className="font-mono text-xs">{serverLabel(activeServer)}</span>
          ) : servers.length === 0 ? (
            "No servers"
          ) : (
            `All servers (${servers.length})`
          )}
        </span>
        <span className="text-ink-3" aria-hidden>
          /
        </span>
        <h1 className="truncate text-[13px] font-normal">{titleForPath(pathname)}</h1>
      </nav>
    </header>
  );
}
