"use client";

import type { Wallet } from "@beaconsgg/identity";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ErrorText, Panel, ToneBadge } from "@/components/primitives";
import { useServerRoles, type SavedServer } from "@/features/servers";
import { describeDirectoryError, fetchListing, listingKey, listingUrl, removeListing } from "./api";
import {
  DEFAULT_DIRECTORY,
  directoryHost,
  directoryOrigin,
  loadDirectory,
  saveDirectory,
} from "./config";

/**
 * The **Server directory** card on a server's settings screen: whether the directory lists the
 * server, and **Remove listing** for the server's admins. Only an admin can prove control, so the
 * card shows only once the wallet's role on the server is known to be `admin`.
 */
export function DirectoryCard({ server, wallet }: { server: SavedServer; wallet: Wallet }) {
  const { roleOf } = useServerRoles();
  if (roleOf(server.origin) !== "admin") return null;
  return <Directory server={server} wallet={wallet} />;
}

function Directory({ server, wallet }: { server: SavedServer; wallet: Wallet }) {
  // Read once on mount: the card renders only after the role read, which never runs on the server,
  // so this cannot differ between the server's render and the browser's.
  const [directory, setDirectory] = useState(loadDirectory);
  const host = server.host.toLowerCase();
  // One read per directory and host: a directory that is down or wrong is not asked over and over.
  const listing = useSWR(listingKey(directory, host), () => fetchListing(directory, host), {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const where = directoryHost(directory);

  const remove = async () => {
    setBusy(true);
    setFailure(undefined);
    try {
      await removeListing(directory, host, wallet);
      toast.success(`${host} is no longer listed on ${where}.`);
    } catch (err) {
      setFailure(describeDirectoryError(err));
    } finally {
      setBusy(false);
      // Read again either way: a removal whose answer was lost may still have gone through.
      void listing.mutate();
    }
  };

  const changeDirectory = (origin: string) => {
    saveDirectory(origin);
    setDirectory(origin);
    setFailure(undefined);
  };

  return (
    <Panel title="Server directory">
      <div className="space-y-3">
        <ListingLine
          state={listing.data}
          error={listing.error}
          loading={listing.isLoading}
          href={listingUrl(directory, host)}
          where={where}
        />

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Directory</span>
          <span className="font-mono break-all text-foreground">{directory}</span>
          {/* Not while a removal is under way: its answer belongs to the directory it asked. */}
          <DirectoryPicker directory={directory} onChange={changeDirectory} disabled={busy} />
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={busy}>
              {busy ? "Removing…" : "Remove listing"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove {host} from the directory on {where}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Players can no longer find the server there. You can submit the server again later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void remove()}>Remove listing</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <ErrorText>{failure}</ErrorText>
      </div>
    </Panel>
  );
}

/** Listed, not listed or unreachable, with what each means for the operator. */
function ListingLine({
  state,
  error,
  loading,
  href,
  where,
}: {
  state: "listed" | "notListed" | undefined;
  error: unknown;
  loading: boolean;
  href: string;
  where: string;
}) {
  if (error !== undefined) {
    return (
      <div className="space-y-1.5">
        <ToneBadge tone="warn">unreachable</ToneBadge>
        <p className="text-sm text-muted-foreground">{describeDirectoryError(error)}</p>
      </div>
    );
  }
  if (loading || state === undefined) {
    return <p className="text-sm text-muted-foreground">Checking the directory…</p>;
  }
  if (state === "listed") {
    return (
      <div className="space-y-1.5">
        <ToneBadge tone="ok">listed</ToneBadge>
        <p className="text-sm text-muted-foreground">
          Players can find this server on {where}.{" "}
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Open the listing on {where}
          </a>
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <ToneBadge>not listed</ToneBadge>
      <p className="text-sm text-muted-foreground">
        The directory shows no public listing for this server. A pending or private listing does not
        show here and can still be removed.
      </p>
    </div>
  );
}

/** Change the directory this browser asks, or go back to the default. */
function DirectoryPicker({
  directory,
  onChange,
  disabled,
}: {
  directory: string;
  onChange: (origin: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(directory);
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const origin = draft.trim() === "" ? DEFAULT_DIRECTORY : directoryOrigin(draft);
    if (origin === undefined) {
      setInvalid(true);
      return;
    }
    onChange(origin);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(directory);
          setInvalid(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" disabled={disabled}>
          Change directory
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <Label htmlFor="directory-address" className="text-xs">
          Directory address
        </Label>
        <div className="mt-2 flex gap-2">
          <Input
            id="directory-address"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
            placeholder={DEFAULT_DIRECTORY}
            aria-invalid={invalid}
          />
          <Button size="sm" onClick={save}>
            Save
          </Button>
        </div>
        {invalid ? (
          <p className="mt-2 text-xs text-destructive">
            Enter an address that starts with https://. Plain http:// works only for localhost.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            Saved in this browser. Leave the field empty to use {DEFAULT_DIRECTORY}.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
