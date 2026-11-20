"use client";

/**
 * @beaconsgg/admin-plugin: the seam between the Beacon operator console and a game's operator screens.
 *
 * The console is game-agnostic: it manages servers, places, media and moderation for every game a
 * server hosts. A game that wants operator screens of its own ships them as a {@link GamePlugin}
 * from its plugin package, a console deployment names the plugins it carries when it builds, and
 * the console renders each under `/games/<slug>`. A plugin depends on this package, never on the console, so the console's repo
 * builds with no game in it and a game's repo builds with no console in it.
 *
 * What the console hands a plugin is the {@link AdminHost}, read with {@link useAdminHost}: the
 * operator's session (server + wallet), the SDK client the console is configured with, the two
 * signed operator calls a game screen needs, and the console's own UI components, so a plugin looks
 * like the rest of the console without importing its component kit. Everything here is types plus
 * one React context; the console provides the value.
 */
import type { BeaconClient } from "@beaconsgg/client-sdk";
import type { Wallet } from "@beaconsgg/identity";
import type { LatLng, Media } from "@beaconsgg/protocol-types";
import {
  createContext,
  useContext,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
} from "react";

/** A game's operator screens, as the console lists them. */
export interface GamePlugin {
  /**
   * The route segment (`/games/<slug>`), the plugin's key, and its game's slug: the console signs the
   * plugin's writes as this game. Lowercase, one path segment.
   */
  slug: string;
  /** The nav label and page title. */
  label: string;
  /** The nav icon. */
  icon: ComponentType;
  /** The screen the console renders under {@link AdminHostContext}. */
  Screen: ComponentType;
  /**
   * Names for this game's room types, keyed by the type as its rooms carry it (`jar`). Optional:
   * the console shows any game's rooms by their raw type, and uses these only for rooms of this
   * plugin's game, as the label and, when given, the colour wherever rooms are grouped by type.
   */
  roomTypes?: Readonly<Record<string, RoomTypeName>>;
}

/** How the console names one of a game's room types. */
export interface RoomTypeName {
  /** The label, in the singular (`Jar`). */
  label: string;
  /** The marker colour, as six-digit hex (`#0ea371`); the console ignores any other form. */
  color?: `#${string}`;
}

/** The server a plugin screen acts on: the operator's active server. */
export interface PluginServer {
  origin: string;
  /** The operator's name for it, or its host. */
  label: string;
  /** The geohash cells the server advertises as its coverage. */
  coverage: readonly string[];
}

/** Why a screen needs a server and a wallet, in the screen's own words (the console words the rest). */
export interface GateNeed {
  /** Completes "Select a single server under Scope in the sidebar: ...". */
  server: string;
  /** Completes "Unlock the operator wallet: ...". */
  wallet: string;
}

/** The operator's session resolved for one screen: the server and wallet, or why not. */
export type SessionGate =
  { ok: true; server: PluginServer; wallet: Wallet } | { ok: false; refusal: string };

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

/**
 * The console's components a plugin renders with. The props are what the console guarantees, not
 * everything its components accept: a plugin that needs more asks for it here.
 */
export interface AdminUi {
  Button: ComponentType<
    ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant; size?: ButtonSize }
  >;
  Input: ComponentType<ComponentPropsWithoutRef<"input">>;
  Switch: ComponentType<{
    id?: string;
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }>;
  Select: ComponentType<{
    value?: string;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    children?: ReactNode;
  }>;
  SelectTrigger: ComponentType<{ id?: string; className?: string; children?: ReactNode }>;
  SelectValue: ComponentType<{ placeholder?: string }>;
  SelectContent: ComponentType<{ children?: ReactNode }>;
  SelectItem: ComponentType<{ value: string; disabled?: boolean; children?: ReactNode }>;
  Tabs: ComponentType<{ defaultValue?: string; className?: string; children?: ReactNode }>;
  TabsList: ComponentType<{ children?: ReactNode }>;
  TabsTrigger: ComponentType<{ value: string; children?: ReactNode }>;
  TabsContent: ComponentType<{ value: string; children?: ReactNode }>;
  Table: ComponentType<ComponentPropsWithoutRef<"table">>;
  TableHeader: ComponentType<ComponentPropsWithoutRef<"thead">>;
  TableBody: ComponentType<ComponentPropsWithoutRef<"tbody">>;
  TableRow: ComponentType<ComponentPropsWithoutRef<"tr">>;
  TableHead: ComponentType<ComponentPropsWithoutRef<"th">>;
  TableCell: ComponentType<ComponentPropsWithoutRef<"td">>;
  /** A titled card: the console's section container. */
  Panel: ComponentType<{ title?: string; children: ReactNode }>;
  /** A labelled form row. */
  Field: ComponentType<{ label: string; children: ReactNode }>;
  /** A small status pill. */
  ToneBadge: ComponentType<{ tone?: "neutral" | "ok" | "warn" | "error"; children: ReactNode }>;
  /** A DID or id, shortened, with copy. */
  Did: ComponentType<{ value: string }>;
  /** The paragraph a screen shows instead of itself when {@link AdminHost.useSession} refuses. */
  GateNotice: ComponentType<{ children: ReactNode }>;
  /** "<children> <server label> — <origin>": which server a screen is about to act on. */
  ActiveServerLine: ComponentType<{ server: PluginServer; children: ReactNode }>;
  /** A click-to-pick map with one marker. `value` is the marker (and the first centre), or none. */
  PointPicker: ComponentType<{ value: LatLng | null; onPick: (point: LatLng) => void }>;
}

/** What the console hands a plugin screen. */
export interface AdminHost {
  /**
   * The operator's active server and unlocked wallet, or the refusal to show instead. A hook, and the
   * one way a screen gets the wallet: a screen that signs takes the session, then hands it down.
   */
  useSession(need: GateNeed): SessionGate;
  /**
   * An SDK client configured like the console's that signs as this plugin's game, and reads that
   * game's content by default (pass `null` games to a read for every game's). A call a server
   * refuses because the operator's wallet session ran out is sent again once the operator unlocks.
   */
  client: BeaconClient;
  /** Upload a photo as a place photo's thumb + full pair (`media.put`, browser-encoded). */
  uploadPlacePhoto(origin: string, wallet: Wallet, file: File): Promise<Media[]>;
  /** Remove a room as a moderation action (`admin.room.remove`). True when it was there. */
  removeRoom(origin: string, wallet: Wallet, id: string, reason?: string): Promise<boolean>;
  /** An error, in the sentence the console shows for it. */
  describeError(err: unknown): string;
  /** Copy to the clipboard; false when the browser refused. */
  copyText(text: string): Promise<boolean>;
  /** The console's toasts. */
  toast: { success(message: string): void; error(message: string): void };
  ui: AdminUi;
}

/** The console provides this around every plugin screen. */
export const AdminHostContext = createContext<AdminHost | null>(null);

/** The host, from inside a plugin screen. Throws outside the console's provider. */
export function useAdminHost(): AdminHost {
  const host = useContext(AdminHostContext);
  if (host === null) throw new Error("a game plugin screen rendered outside the console's host");
  return host;
}
