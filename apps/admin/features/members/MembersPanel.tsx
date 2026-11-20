"use client";

import type { Wallet } from "@beaconsgg/identity";
import {
  ACCESS_MARKER,
  type AccessEntry,
  type DidKey,
  type ServerAccessLevel,
} from "@beaconsgg/protocol-types";
import { useEffect, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ErrorText, ToneBadge } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { OwnerLabel } from "@/features/media";
import { ActiveServerLine, GateNotice, useAdminStatus, useSingleServer } from "@/features/servers";
import { accessAdd, accessAdmitAll, accessDecline, accessFetch, accessRemove } from "./api";

/** What each level means for who may write, in the operator's words. */
const LEVEL_NOTE: Record<ServerAccessLevel, string> = {
  open: "Anyone may write here. The list below takes effect if you change the access level.",
  request: "Only members may write. Players can ask to join from the game.",
  private: "Only members may write, and players cannot ask to join. Add members by account.",
};

/**
 * The member list (the server's admin API spec, beacon.server `doc/spec/admin-api.md` §6): requests
 * to join with the requester's profile, the members, and the declined. Targets one server and needs
 * an unlocked wallet, because every action is a signed admin op.
 */
export function MembersPanel() {
  const gate = useSingleServer({
    server: "members are kept per server",
    wallet: "approving and removing members are signed admin ops",
    capability: ACCESS_MARKER,
  });
  if (!gate.ok) return <GateNotice>{gate.refusal}</GateNotice>;
  const { server } = gate;
  return (
    <div className="space-y-4">
      <ActiveServerLine server={server}>Members of</ActiveServerLine>
      <Members origin={server.origin} wallet={gate.wallet} />
    </div>
  );
}

function Members({ origin, wallet }: { origin: string; wallet: Wallet }) {
  const status = useAdminStatus(origin);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const list = useSWR(
    ["admin.access", origin, wallet.account.did],
    () => accessFetch(origin, wallet),
    {
      revalidateOnFocus: false,
    },
  );
  // No poll of its own: the status poll already counts the requests waiting, so a change in that
  // count reads the list again, and the list and the badge agree.
  const pendingCount = status.data?.counts.accessPending;
  const seen = useRef(pendingCount);
  const { mutate } = list;
  useEffect(() => {
    const before = seen.current;
    seen.current = pendingCount;
    if (before !== undefined && before !== pendingCount) void mutate();
  }, [pendingCount, mutate]);

  /**
   * Run one signed action, one at a time, then refresh the list and the status, whose pending
   * count the badge and the dashboard show. True when the action went through.
   */
  const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError(undefined);
    setBusy(true);
    try {
      await fn();
      await Promise.all([list.mutate(), status.mutate()]);
      return true;
    } catch (err) {
      setError(describeApiError(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  /** A button for one action on one entry. */
  const action = (label: string, run: () => Promise<unknown>, variant?: "ghost" | "outline") => (
    <Button size="sm" variant={variant} disabled={busy} onClick={() => void act(run)}>
      {label}
    </Button>
  );
  const add = (did: DidKey, done: string) => async () => {
    await accessAdd(origin, wallet, did);
    toast.success(done);
  };
  const remove = (did: DidKey, done: string) => async () => {
    if (await accessRemove(origin, wallet, did)) toast.success(done);
    else toast.warning("Not on the list (already removed?)");
  };

  const level = status.data?.accessLevel;
  const groups = { pending: [], member: [], declined: [] } as Record<
    AccessEntry["status"],
    AccessEntry[]
  >;
  for (const e of list.data ?? []) groups[e.status].push(e);
  const count = (n: number) => (list.data ? ` (${String(n)})` : "");

  return (
    <>
      {level ? (
        <p className="text-sm text-muted-foreground">
          Access level <ToneBadge tone={level === "open" ? "ok" : "warn"}>{level}</ToneBadge>.{" "}
          {LEVEL_NOTE[level]}
        </p>
      ) : null}
      <ErrorText>{list.error ? describeApiError(list.error) : error}</ErrorText>

      <Card>
        <CardHeader>
          <CardTitle>Requests to join{count(groups.pending.length)}</CardTitle>
          <CardDescription>
            Oldest first. Each player&apos;s name and picture come from the profile they published
            to this server. Approve to let them write. A declined player cannot ask again until you
            approve or remove them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EntryTable
            origin={origin}
            entries={groups.pending}
            empty="No requests waiting."
            actions={(e) => (
              <>
                {action("Approve", add(e.did, "Request approved"))}
                {action(
                  "Decline",
                  async () => {
                    await accessDecline(origin, wallet, e.did);
                    toast.success("Request declined");
                  },
                  "ghost",
                )}
              </>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members{count(groups.member.length)}</CardTitle>
          <CardDescription>
            Members may write when the access level is request or private. Admins are always members
            and are not listed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <AddMember busy={busy} onAdd={(did) => act(add(did, "Member added"))} />
          <Confirm
            trigger="Admit everyone with a profile here"
            title="Admit everyone with a profile here?"
            confirm="Admit"
            busy={busy}
            onConfirm={() =>
              void act(async () => {
                const added = await accessAdmitAll(origin, wallet);
                toast.success(
                  `${added.toLocaleString()} ${added === 1 ? "member" : "members"} added`,
                );
              })
            }
          >
            Every account that has published a profile to this server becomes a member. Use it when
            you move the server off open, so its current players can keep playing. Pending requests
            and declined players stay as they are.
          </Confirm>
          <EntryTable
            origin={origin}
            entries={groups.member}
            empty="No members yet."
            actions={(e) => (
              <Confirm
                trigger="Remove"
                title="Remove this member?"
                confirm="Remove"
                busy={busy}
                onConfirm={() => void act(remove(e.did, "Member removed"))}
              >
                They can no longer write here while the access level is request or private.
              </Confirm>
            )}
          />
        </CardContent>
      </Card>

      {groups.declined.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Declined{count(groups.declined.length)}</CardTitle>
            <CardDescription>
              Remove a declined player to let them ask again, or approve them now.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EntryTable
              origin={origin}
              entries={groups.declined}
              actions={(e) => (
                <>
                  {action("Approve", add(e.did, "Player approved"), "outline")}
                  {action("Remove", remove(e.did, "Player may ask again"), "ghost")}
                </>
              )}
            />
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

/** A table of entries, each with the account's profile, its note and when it asked. */
function EntryTable({
  origin,
  entries,
  empty,
  actions,
}: {
  origin: string;
  entries: AccessEntry[];
  empty?: string;
  actions: (entry: AccessEntry) => ReactNode;
}) {
  if (entries.length === 0) {
    return empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null;
  }
  return (
    <Table>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.did}>
            <TableCell>
              <OwnerLabel origin={origin} did={entry.did} detailed />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {entry.note ? <q>{entry.note}</q> : "—"}
            </TableCell>
            <TableCell className="text-right text-xs text-muted-foreground">
              {when(entry)}
            </TableCell>
            <TableCell className="space-x-1 text-right whitespace-nowrap">
              {actions(entry)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The date an entry changed last, in the words its status calls for. */
function when(entry: AccessEntry): string {
  const date = (iso: string) => new Date(iso).toLocaleDateString();
  if (entry.status === "pending" && entry.requestedAt) return `asked ${date(entry.requestedAt)}`;
  if (entry.decidedAt)
    return `${entry.status === "member" ? "added" : "declined"} ${date(entry.decidedAt)}`;
  return "";
}

function AddMember({ busy, onAdd }: { busy: boolean; onAdd: (did: DidKey) => Promise<boolean> }) {
  const [did, setDid] = useState("");
  const valid = did.trim().startsWith("did:key:");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        // Cleared only when the add went through, so a refused DID stays there to fix.
        if (valid) void onAdd(did.trim() as DidKey).then((ok) => ok && setDid(""));
      }}
    >
      <div className="grow space-y-1.5">
        <Label htmlFor="member-did">Account did:key</Label>
        <Input
          id="member-did"
          value={did}
          onChange={(e) => setDid(e.target.value)}
          placeholder="did:key:z…"
        />
      </div>
      <Button type="submit" disabled={!valid || busy}>
        Add member
      </Button>
    </form>
  );
}

/** A button that asks before it acts: for the actions that change who may write in bulk or at once. */
function Confirm({
  trigger,
  title,
  confirm,
  busy,
  onConfirm,
  children,
}: {
  trigger: string;
  title: string;
  confirm: string;
  busy: boolean;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{children}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirm}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
