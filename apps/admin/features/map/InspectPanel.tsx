"use client";

import { useState } from "react";
import type { MediaCredit } from "@beaconsgg/protocol-types";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Did, ErrorText, Field, Panel, ToneBadge } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { OwnerLabel } from "@/features/media";
import { removeRoom } from "@/features/moderation";
import { ImageStrip, PlaceDescriptor, type PlaceImage } from "@/features/places";
import { trustRefusal, useServerRoles, useServers } from "@/features/servers";
import { useWallet } from "@/features/wallet";
import type { RoomCard } from "./api";
import { claimProgress, openedOps, type PointFeature } from "./logic";

export type Inspect = PointFeature["properties"];

/**
 * The click-inspect card: what/where/whose, plus removal for custodied rooms (the sole
 * holder of the map feature's `@/features/moderation` dependency). Removal and the pointers to the
 * admin screens show only when the wallet may be an admin of the item's server: a visitor sees the
 * item and nothing to act on. A room also shows its game and
 * what it lets other games do, from the full room record. Places route to the Places
 * page for curation; scouts expire on their own TTL.
 */
export function InspectPanel({
  inspect,
  serverName,
  room,
  roomError,
  geometryShown = false,
  images = [],
  description,
  descriptionCredit,
  website,
  wikipedia,
  altNames,
  onClose,
  onRemoved,
}: {
  inspect: Inspect;
  serverName: string;
  /** A clicked room's full record: `undefined` while loading, `null` once the server says it is gone. */
  room?: RoomCard | null | undefined;
  /** Why the room record could not be read. */
  roomError?: string | undefined;
  /** True while the place's area geometry is outlined on the map beneath this card. */
  geometryShown?: boolean;
  /** A clicked place's resolved photos (thumb + full link + credit), when it has any. */
  images?: PlaceImage[];
  /** A clicked place's detail-only descriptor fields (from the same detail read as geometry). */
  description?: string | undefined;
  descriptionCredit?: MediaCredit | undefined;
  website?: string | undefined;
  wikipedia?: string | undefined;
  altNames?: readonly string[] | undefined;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { wallet } = useWallet();
  const known = useServers();
  const admin = useServerRoles().mayAdmin(inspect.origin);
  // Removal is a signed admin request to the room's server: never to one whose identity changed, hasn't
  // been checked yet, or is no longer saved. The map still shows its rooms; it won't act on them.
  const saved = known.servers.find((s) => s.origin === inspect.origin);
  const untrusted = saved
    ? trustRefusal(saved, known)
    : "This room's server is no longer saved, so the console sends it nothing.";
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const isRoom = inspect.kind === "room";
  const removable = isRoom && admin;

  const remove = async () => {
    if (!wallet || untrusted !== undefined) return;
    setError(undefined);
    try {
      await removeRoom(inspect.origin, wallet, inspect.id, reason || undefined);
      toast.success("Room removed");
      onRemoved();
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  return (
    <Panel>
      <div className="flex items-center gap-2">
        <ToneBadge tone={inspect.kind === "place" ? "ok" : "neutral"}>{inspect.kind}</ToneBadge>
        <span className="grow truncate text-sm font-medium">{inspect.title}</span>
        <button
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {inspect.subtitle ? (
        <p className="mt-1 text-xs text-muted-foreground">{inspect.subtitle}</p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">on {serverName}</p>
      <div className="mt-1">
        <Did value={inspect.id} />
      </div>
      {isRoom ? <RoomGame origin={inspect.origin} room={room} error={roomError} /> : null}
      <ImageStrip images={images} size="sm" className="mt-2 gap-2" />
      <PlaceDescriptor
        description={description}
        descriptionCredit={descriptionCredit}
        website={website}
        wikipedia={wikipedia}
        altNames={altNames}
        descriptionClassName="mt-2"
        websiteClassName="mt-1"
      />
      {inspect.kind === "place" && admin ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {images.length === 0 ? "No photo. " : ""}
          {geometryShown ? "Area geometry outlined on the map. " : ""}Curate this place on the
          Places page.
        </p>
      ) : null}
      {inspect.kind === "scout" && admin ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Scout reports expire on their own TTL; block the owner (Moderation) for abuse.
        </p>
      ) : null}
      {removable && untrusted !== undefined ? (
        <p className="mt-2 text-xs text-destructive">{untrusted}</p>
      ) : removable ? (
        !confirming ? (
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            Remove room…
          </Button>
        ) : (
          <div className="mt-2 space-y-2">
            <Field label="Reason (audit log)">
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="optional"
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => void remove()}>
                Confirm remove
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Watchers see the normal closed/gone events; a racing op gets “expired”.
            </p>
          </div>
        )
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Panel>
  );
}

/** A room's game, and the ops it opens to other games (the room's own game may apply every op). */
function RoomGame({
  origin,
  room,
  error,
}: {
  origin: string;
  room: RoomCard | null | undefined;
  error: string | undefined;
}) {
  if (error !== undefined) return <ErrorText>{error}</ErrorText>;
  if (room == null) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {room === null ? "The server no longer has this room." : "Loading the room…"}
      </p>
    );
  }
  const opened = openedOps(room);
  const closed = room.game
    ? `None: only ${room.game} can act on it`
    : "None: no game can act on it";
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {room.name ? (
        <>
          <dt className="text-muted-foreground">Name</dt>
          <dd>{room.name}</dd>
        </>
      ) : null}
      <dt className="text-muted-foreground">Game</dt>
      <dd>{room.game ? <span className="font-mono">{room.game}</span> : "None listed"}</dd>
      <dt className="text-muted-foreground">Other games</dt>
      <dd>
        {opened.length === 0 ? (
          closed
        ) : (
          <ul>
            {opened.map(({ op, games }) => (
              <li key={op}>
                <span className="font-mono">{op}</span>:{" "}
                {games === "any" ? "any game" : games.join(", ")}
              </li>
            ))}
          </ul>
        )}
      </dd>
      <dt className="text-muted-foreground">Placed by</dt>
      <dd>
        <Did value={room.placedBy} />
      </dd>
      <WaitingToClaim origin={origin} room={room} />
    </dl>
  );
}

/** How many contributors have yet to claim; their names are looked up only when asked for. */
function WaitingToClaim({ origin, room }: { origin: string; room: RoomCard }) {
  const [showing, setShowing] = useState(false);
  const progress = claimProgress(room);
  if (!progress) return null;
  const { waiting, total } = progress;
  return (
    <>
      <dt className="text-muted-foreground">Waiting to claim</dt>
      <dd className="min-w-0">
        {waiting.length} of {total}
        {waiting.length > 0 ? (
          <Button
            variant="link"
            size="xs"
            aria-expanded={showing}
            onClick={() => setShowing(!showing)}
          >
            {showing ? "Hide" : "Show who"}
          </Button>
        ) : null}
        {showing ? (
          <ul className="space-y-1">
            {waiting.map((did) => (
              <li key={did}>
                <OwnerLabel origin={origin} did={did} />
              </li>
            ))}
          </ul>
        ) : null}
      </dd>
    </>
  );
}
