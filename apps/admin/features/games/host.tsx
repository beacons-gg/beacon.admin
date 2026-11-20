"use client";

import {
  AdminHostContext,
  type AdminHost,
  type GateNeed,
  type SessionGate,
} from "@beaconsgg/admin-plugin";
import { useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { Did, Field, Panel, ToneBadge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PointPicker } from "@/features/map";
import { removeRoom } from "@/features/moderation";
import { uploadPlacePhoto } from "@/features/places";
import { GateNotice, serverLabel, ServerLine, useSingleServer } from "@/features/servers";
import { clientFor, describeApiError } from "@/lib/api";
import { copyText } from "@/lib/utils";

/**
 * The console's session as a plugin sees it: the single-server gate, the server reduced to its label.
 * The reduced server is kept while the saved one is, so a plugin can depend on it in an effect.
 */
function useSession(need: GateNeed): SessionGate {
  const gate = useSingleServer(need);
  const saved = gate.ok ? gate.server : undefined;
  const server = useMemo(
    () => saved && { origin: saved.origin, label: serverLabel(saved), coverage: saved.coverage },
    [saved],
  );
  if (!gate.ok) return gate;
  return { ok: true, server: server!, wallet: gate.wallet };
}

/** The parts of the host that do not depend on which game is asking; {@link hostFor} adds the rest. */
const SHARED_HOST: Omit<AdminHost, "client" | "uploadPlacePhoto"> = {
  useSession,
  removeRoom,
  describeError: describeApiError,
  copyText,
  toast: { success: toast.success, error: toast.error },
  ui: {
    Button,
    Input,
    Switch,
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    Tabs,
    TabsList,
    TabsTrigger,
    TabsContent,
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
    Panel,
    Field,
    ToneBadge,
    Did,
    GateNotice,
    ActiveServerLine: ({ server, children }) => (
      <ServerLine label={server.label} origin={server.origin}>
        {children}
      </ServerLine>
    ),
    PointPicker,
  },
};

/**
 * What the console hands a game plugin (`@beaconsgg/admin-plugin`): its own gate, signed calls and
 * components, so a plugin screen behaves and looks like the console's own, and a client that signs
 * as the plugin's game. Every game write names its game, and a plugin's writes (a challenge it
 * places, a photo it uploads) are its game's, while the console's own are nobody's.
 */
function hostFor(game: string): AdminHost {
  const pluginClient = clientFor(game);
  return {
    ...SHARED_HOST,
    client: pluginClient,
    uploadPlacePhoto: (origin, wallet, file) =>
      uploadPlacePhoto(origin, wallet, file, pluginClient),
  };
}

/** The host around a plugin's screen, for the game `game` (the plugin's slug). */
export function PluginHost({ game, children }: { game: string; children: ReactNode }) {
  const host = useMemo(() => hostFor(game), [game]);
  return <AdminHostContext.Provider value={host}>{children}</AdminHostContext.Provider>;
}
