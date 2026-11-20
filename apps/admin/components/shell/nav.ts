import {
  CompassIcon,
  DatabaseBackupIcon,
  ImageIcon,
  LayoutDashboardIcon,
  MapPinnedIcon,
  ServerIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UsersIcon,
} from "lucide-react";
import type { AdminStatus } from "@beaconsgg/protocol-types";
import type { ComponentType } from "react";
import { GAME_PLUGINS } from "@/features/games/plugins";

/** The console's navigation model — feature-agnostic data the sidebar renders. */
export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType;
  /** The line under the screen's title: what it is for. */
  lead?: string;
  /** A count from the selected server's `admin.status` to show beside the item when it is not zero. */
  count?: keyof AdminStatus["counts"];
  /**
   * A screen anyone signed in can use. Every other screen is for a server's admins: the sidebar
   * leaves those out when the wallet is known not to be an admin of any server in scope
   * (`useServerRoles`), and when no server is saved. Admin is the default, so a new screen is
   * hidden from visitors unless it says otherwise.
   */
  open?: boolean;
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    items: [
      { href: "/", label: "Explore", icon: CompassIcon, open: true },
      {
        href: "/overview",
        open: true,
        label: "Overview",
        icon: LayoutDashboardIcon,
        lead: "Each server's status: version, uptime, capabilities and its counts.",
      },
    ],
  },
  {
    label: "Curate",
    items: [
      {
        href: "/places",
        label: "Places",
        icon: MapPinnedIcon,
        lead: "Imports, proposals, conflicts and every place's fields, one server at a time.",
      },
      {
        href: "/media",
        label: "Media",
        icon: ImageIcon,
        lead: "A server's media store: browse, filter, review and delete, one item or many.",
      },
      {
        href: "/members",
        label: "Members",
        icon: UsersIcon,
        lead: "Requests to join and who may write, when a server is not open to everyone.",
        count: "accessPending",
      },
      {
        href: "/moderation",
        label: "Moderation",
        icon: ShieldCheckIcon,
        lead: "Who is blocked and why, and the rooms and media to take down.",
      },
    ],
  },
  // The console's game-aware sections live under Games, one entry per game plugin in this build,
  // so the platform surfaces above stay visibly game-agnostic. A build with no plugins has no group.
  ...(GAME_PLUGINS.length === 0
    ? []
    : [
        {
          label: "Games",
          items: GAME_PLUGINS.map((p) => ({
            href: `/games/${p.slug}`,
            label: p.label,
            icon: p.icon,
          })),
        },
      ]),
  {
    label: "Fleet",
    items: [
      {
        href: "/servers",
        open: true,
        label: "Servers",
        icon: ServerIcon,
        lead: "The servers this console signs for, each checked against its signed descriptor.",
      },
      {
        href: "/settings",
        label: "Settings",
        icon: SlidersHorizontalIcon,
        lead: "A server's configuration: the editable settings in one signed write, the deploy-time ones beside them.",
      },
      {
        href: "/backup",
        label: "Backup",
        icon: DatabaseBackupIcon,
        lead: "Back a server up to an S3 bucket, or restore one from a backup.",
      },
    ],
  },
];

/** Longest-prefix match so nested routes (e.g. /places/:id) still light their nav item + title. */
export function activeHref(pathname: string): string {
  const all = NAV.flatMap((g) => g.items.map((i) => i.href));
  const matches = all.filter((h) => (h === "/" ? pathname === "/" : pathname.startsWith(h)));
  return matches.sort((a, b) => b.length - a.length)[0] ?? pathname;
}

export function leadForPath(pathname: string): string | undefined {
  const href = activeHref(pathname);
  return NAV.flatMap((g) => g.items).find((i) => i.href === href)?.lead;
}

/** Whether the path is one of the console's screens (a 404 is not, and gets no title of its own). */
export function isScreen(pathname: string): boolean {
  const href = activeHref(pathname);
  return NAV.some((g) => g.items.some((i) => i.href === href));
}

export function titleForPath(pathname: string): string {
  const href = activeHref(pathname);
  return NAV.flatMap((g) => g.items).find((i) => i.href === href)?.label ?? "Beacon";
}
