"use client";

import Link from "next/link";
import { KICKER } from "@/components/primitives";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { serverLabel, useServerRoles, useServers } from "@/features/servers";
import { activeHref, NAV } from "./nav";
import { Mark } from "./Mark";
import { OperatorWell } from "./OperatorWell";
import { StatusCountBadge } from "./StatusCountBadge";

/** A sidebar group's heading: tracked mono capitals in the quiet ink. */
const LABEL = `h-auto px-2 pt-3 pb-2 ${KICKER}`;

/** The active item sits on `surface-2` in full ink; the rest are the second ink. */
const ITEM =
  "h-8 gap-2.5 rounded-md text-[13px] text-muted-foreground hover:bg-sidebar-accent/60 data-[active=true]:bg-sidebar-accent data-[active=true]:font-normal data-[active=true]:text-foreground [&>svg]:size-3.5";

/**
 * The console's sidebar: the mark, the destinations, the saved
 * servers as the scope (a square in its state: green verified, red identity changed, gold while it
 * is not verified yet, which is also a server that could not be reached and is tried again), and the
 * operator well at the foot.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const current = activeHref(pathname);
  const servers = useServers();
  const roles = useServerRoles();
  // Admin screens show while any server in scope may be one the wallet administers, so the list
  // does not jump while the first status reads land.
  const anyAdmin = servers.targets.some((s) => roles.mayAdmin(s.origin));
  const nav = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.open || anyAdmin),
  })).filter((group) => group.items.length > 0);
  // On a phone the sidebar is a sheet over the page: a choice made in it closes it.
  const { setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);

  return (
    <Sidebar variant="inset" className="border-r-0">
      <SidebarHeader className="px-3.5 pt-3.5 pb-3">
        <Link href="/" className="no-underline" onClick={close}>
          <Mark />
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 px-1.5">
        {nav.map((group, i) => (
          <SidebarGroup key={group.label ?? i} className="py-1">
            {group.label ? (
              <SidebarGroupLabel className={LABEL}>{group.label}</SidebarGroupLabel>
            ) : null}
            <SidebarMenu className="gap-px">
              {group.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={current === item.href}
                    tooltip={item.label}
                    className={ITEM}
                  >
                    <Link href={item.href} onClick={close}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.count ? <StatusCountBadge count={item.count} /> : null}
                  {item.href === "/servers" && servers.servers.length > 0 ? (
                    <SidebarMenuBadge className="font-mono text-[11px] text-ink-3">
                      {servers.servers.length}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}

        {servers.servers.length > 0 ? (
          <SidebarGroup className="py-1">
            <SidebarGroupLabel className={LABEL}>scope</SidebarGroupLabel>
            <SidebarMenu className="gap-px">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={servers.active === undefined}
                  onClick={() => {
                    servers.setActive(undefined);
                    close();
                  }}
                  className={ITEM}
                >
                  <StateSquare tone="text-muted-foreground" />
                  <span>All servers</span>
                </SidebarMenuButton>
                <SidebarMenuBadge className="font-mono text-[11px] text-ink-3">
                  {servers.servers.length}
                </SidebarMenuBadge>
              </SidebarMenuItem>
              {servers.servers.map((server) => {
                const changed = servers.identityChanged.includes(server.origin);
                const preview = servers.preview === server.origin;
                const checking = servers.checking.includes(server.origin);
                return (
                  <SidebarMenuItem key={server.origin}>
                    <SidebarMenuButton
                      isActive={servers.active === server.origin}
                      onClick={() => {
                        servers.setActive(server.origin);
                        close();
                      }}
                      title={server.origin}
                      className={changed || preview ? `${ITEM} pr-24` : ITEM}
                    >
                      <StateSquare
                        tone={
                          changed ? "text-status-crit" : checking ? "text-gold" : "text-status-ok"
                        }
                        blink={checking}
                      />
                      <span className="truncate font-mono text-xs">{serverLabel(server)}</span>
                      <span className="sr-only">
                        {preview ? ", quick view, not saved" : ""}
                        {changed
                          ? ", identity changed"
                          : checking
                            ? ", not verified yet"
                            : ", verified"}
                      </span>
                    </SidebarMenuButton>
                    {changed ? (
                      <SidebarMenuBadge
                        aria-hidden
                        className="font-mono text-[11px] text-status-crit peer-hover/menu-button:text-status-crit peer-data-[active=true]/menu-button:text-status-crit"
                      >
                        key changed
                      </SidebarMenuBadge>
                    ) : preview ? (
                      <SidebarMenuBadge aria-hidden className="font-mono text-[11px] text-gold">
                        quick view
                      </SidebarMenuBadge>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}
      </SidebarContent>

      <SidebarFooter className="px-3 pb-3">
        <OperatorWell />
      </SidebarFooter>
    </Sidebar>
  );
}

/** A square with a dot inside, in a status colour: a server's state in the list of them. */
function StateSquare({ tone, blink = false }: { tone: string; blink?: boolean }) {
  return (
    <span
      className={`mx-0.5 grid size-2.5 shrink-0 place-items-center border-[1.5px] border-current ${tone} ${blink ? "blink" : ""}`}
      aria-hidden
    >
      <span className="size-[3px] bg-current" />
    </span>
  );
}
