"use client";

import type { DidKey } from "@beaconsgg/protocol-types";
import { useState } from "react";
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
import { Did } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { removeMedia } from "@/features/media";
import { ActiveServerLine, GateNotice, useSingleServer } from "@/features/servers";
import { useWallet } from "@/features/wallet";
import { blocklistAdd, blocklistFetch, blocklistRemove, removeRoom } from "./api";

/**
 * The moderation surface (the server's admin API spec, beacon.server `doc/spec/admin-api.md` §3):
 * the durable blocklist manager plus remove-a-room / remove-a-media tools. Targets ONE server and
 * needs an unlocked wallet, because every action is a signed admin op that logs a server-side audit
 * line.
 */
export function ModerationPanel() {
  const gate = useSingleServer({
    server: "moderation targets one server at a time",
    wallet: "moderation actions are signed admin ops",
  });
  if (!gate.ok) return <GateNotice>{gate.refusal}</GateNotice>;
  const { server } = gate;

  return (
    <div className="space-y-4">
      <ActiveServerLine server={server}>Moderating</ActiveServerLine>
      <BlockedAccounts origin={server.origin} />
      <RemoveTools origin={server.origin} />
    </div>
  );
}

function BlockedAccounts({ origin }: { origin: string }) {
  const { wallet } = useWallet();
  const [did, setDid] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const list = useSWR(
    wallet ? ["blocklist", origin, wallet.account.did] : null,
    () => blocklistFetch(origin, wallet!),
    { revalidateOnFocus: false },
  );

  const act = async (fn: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await fn();
      await list.mutate();
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Blocked accounts{list.data ? ` (${list.data.length})` : ""}</CardTitle>
        <CardDescription>
          A blocked account is refused on every signed capability or admin request, immediately and
          durably. Admin accounts cannot be blocked. An entry seeded from{" "}
          <code>BEACON_BLOCKLIST</code> returns at the server&apos;s next restart while that setting
          still lists it, so remove it there as well as here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (did.startsWith("did:key:"))
              void act(async () => {
                await blocklistAdd(origin, wallet!, did as DidKey, reason || undefined);
                setDid("");
                setReason("");
                toast.success("Account blocked");
              });
          }}
        >
          <div className="grow space-y-1.5">
            <Label htmlFor="block-did">Account did:key</Label>
            <Input
              id="block-did"
              value={did}
              onChange={(e) => setDid(e.target.value)}
              placeholder="did:key:z…"
            />
          </div>
          <div className="grow space-y-1.5">
            <Label htmlFor="block-reason">Reason (audit + entry)</Label>
            <Input
              id="block-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="spam"
            />
          </div>
          <Button type="submit" disabled={!did.startsWith("did:key:")}>
            Block
          </Button>
        </form>
        {list.error ? (
          <p className="text-sm text-destructive">{describeApiError(list.error)}</p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {list.data && list.data.length > 0 ? (
          <Table>
            <TableBody>
              {list.data.map((entry) => (
                <TableRow key={entry.did}>
                  <TableCell>
                    <Did value={entry.did} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{entry.reason ?? "—"}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {entry.addedBy === "env" ? "env" : "admin"} ·{" "}
                    {new Date(entry.addedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        void act(async () => {
                          if (await blocklistRemove(origin, wallet!, entry.did))
                            toast.success("Account unblocked");
                          else toast.warning("Not blocked (already unblocked?)");
                        })
                      }
                    >
                      Unblock
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : list.data ? (
          <p className="text-sm text-muted-foreground">No blocked accounts.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** One shared shape for the two removal tools: target input + reason → removed/not-found. */
function RemoveTools({ origin }: { origin: string }) {
  const { wallet } = useWallet();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <RemoveTool
        title="Remove a room"
        label="Room id (unique@host)"
        placeholder="01J…@beacon.example"
        run={(target, reason) => removeRoom(origin, wallet!, target, reason)}
        note="Rides the engine's normal close path — watchers get the standard closed/gone events."
      />
      <RemoveTool
        title="Remove a media object"
        label="Content hash"
        placeholder="sha256 base64url"
        run={(target, reason) => removeMedia(origin, wallet!, target, reason)}
        note="Deletes blob + metadata. A re-upload re-creates it, so block the owner for repeat abuse."
      />
    </div>
  );
}

function RemoveTool({
  title,
  label,
  placeholder,
  note,
  run,
}: {
  title: string;
  label: string;
  placeholder: string;
  note: string;
  run: (target: string, reason: string | undefined) => Promise<boolean>;
}) {
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = async () => {
    setError(undefined);
    setResult(undefined);
    try {
      const removed = await run(target.trim(), reason || undefined);
      setResult(removed ? "Removed." : "Not found (already gone?).");
      if (removed) toast.success("Removed");
      else toast.warning("Not found (already gone?)");
      setTarget("");
      setReason("");
    } catch (err) {
      setError(describeApiError(err));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>{label}</Label>
          <Input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={placeholder}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Reason (audit log)</Label>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="optional"
          />
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={!target.trim()}>
              Remove
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{title}?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-mono break-all">{target.trim()}</span>
                <br />
                {note}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void submit()}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {result ? <p className="text-sm text-muted-foreground">{result}</p> : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
