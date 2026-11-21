"use client";

import type { Wallet } from "@beaconsgg/identity";
import type { MediaListItem } from "@beaconsgg/protocol-types";
import { FileAudioIcon, ImageOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Did, ToneBadge } from "@/components/primitives";
import { describeApiError } from "@/lib/api";
import { avatarEmoji, formatBytes } from "@/lib/format";
import {
  ActiveServerLine,
  GateNotice,
  useSingleServer,
  type SavedServer,
} from "@/features/servers";
import { removeMedia, reviewMedia } from "./api";
import { runBulk } from "./bulk";
import { useProfile } from "./useProfile";
import { useMediaList, type MediaFilters, type MediaSort } from "./useMediaList";

/**
 * The media management surface (the server's admin API spec, beacon.server `doc/spec/admin-api.md`
 * §3): browse the content-addressed store, sort by recency or size, filter by owner / type / review
 * state, preview thumbnails full-size, multi-select for **bulk** review/delete, and act on single
 * items. Targets ONE server and needs an unlocked wallet, because every read and write is a signed
 * admin op.
 */
export function MediaBrowser() {
  const gate = useSingleServer({
    server: "media management targets one server at a time",
    wallet: "listing and moderating media are signed admin reads/ops",
  });
  if (!gate.ok) return <GateNotice>{gate.refusal}</GateNotice>;
  const { server, wallet } = gate;

  return <Browser server={server} wallet={wallet} />;
}

function Browser({ server, wallet }: { server: SavedServer; wallet: Wallet }) {
  const { origin } = server;
  const [ownerInput, setOwnerInput] = useState("");
  const [typeInput, setTypeInput] = useState("");
  const [applied, setApplied] = useState<{ owner: string; type: string }>({ owner: "", type: "" });
  const [reviewed, setReviewed] = useState<"all" | "reviewed" | "unreviewed">("all");
  const [sort, setSort] = useState<MediaSort>("recent");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // A plain object is fine — the hook keys its effects on the primitive filter values, not identity.
  const filters: MediaFilters = {
    ...(applied.owner ? { owner: applied.owner } : {}),
    ...(applied.type ? { type: applied.type } : {}),
    ...(reviewed !== "all" ? { reviewed } : {}),
  };

  const { items, loading, error, hasMore, loadMore, markReviewedLocally, removeLocally } =
    useMediaList(origin, wallet, filters, sort);

  // Keep the selection to what's on screen: a filter/sort reset replaces the rows and a bulk removal
  // drops them, so prune to the visible hashes on every `items` change (same ref when nothing changes).
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(items.map((i) => i.hash));
      const next = new Set([...prev].filter((h) => visible.has(h)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  const selectedHashes = items.filter((i) => selected.has(i.hash)).map((i) => i.hash);
  const allSelected = items.length > 0 && selectedHashes.length === items.length;
  const someSelected = selectedHashes.length > 0 && !allSelected;

  const setSelection = (hash: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(hash);
      else next.delete(hash);
      return next;
    });

  // One bulk lifecycle for both actions: guard → busy → runBulk (per-item op + local update) →
  // deselect the succeeded (failed stay selected for a retry) → ok/failed toast. Only the per-item
  // `op` and the `verb` differ between review and delete.
  const runSelection = async (verb: string, op: (hash: string) => Promise<void>) => {
    if (selectedHashes.length === 0) return;
    setBulkBusy(true);
    try {
      const done: string[] = [];
      const { ok, failed } = await runBulk(selectedHashes, async (hash) => {
        await op(hash);
        done.push(hash);
      });
      const doneSet = new Set(done);
      setSelected((prev) => new Set([...prev].filter((h) => !doneSet.has(h))));
      if (failed) toast.warning(`${verb} ${ok} · ${failed} failed`);
      else toast.success(`${verb} ${ok}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkReview = (mark: boolean) =>
    runSelection(mark ? "Reviewed" : "Unmarked", async (hash) => {
      const res = await reviewMedia(origin, wallet, hash, mark);
      markReviewedLocally(hash, res.reviewedAt, res.reviewedBy);
    });

  const bulkDelete = (reason: string) =>
    runSelection("Removed", async (hash) => {
      await removeMedia(origin, wallet, hash, reason || undefined);
    });

  return (
    <div className="space-y-4">
      <ActiveServerLine server={server}>Media on</ActiveServerLine>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ owner: ownerInput.trim(), type: typeInput.trim() });
        }}
      >
        <div className="grow space-y-1.5">
          <Label htmlFor="m-owner">Owner did:key</Label>
          <Input
            id="m-owner"
            value={ownerInput}
            onChange={(e) => setOwnerInput(e.target.value)}
            placeholder="did:key:z… (exact)"
          />
        </div>
        <div className="w-40 space-y-1.5">
          <Label htmlFor="m-type">MIME type</Label>
          <Input
            id="m-type"
            value={typeInput}
            onChange={(e) => setTypeInput(e.target.value)}
            placeholder="image/png"
          />
        </div>
        <div className="w-40 space-y-1.5">
          <Label>Review state</Label>
          <Select
            value={reviewed}
            onValueChange={(v) => setReviewed(v as "all" | "reviewed" | "unreviewed")}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unreviewed">Unreviewed</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1.5">
          <Label>Sort by</Label>
          <Select value={sort} onValueChange={(v) => setSort(v as MediaSort)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Newest</SelectItem>
              <SelectItem value="size">Largest</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {error ? <p className="text-sm text-destructive">{describeApiError(error)}</p> : null}

      {items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              aria-label="Select all on page"
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={(c) =>
                setSelected(c === true ? new Set(items.map((i) => i.hash)) : new Set())
              }
            />
            <span className="text-muted-foreground">
              {selectedHashes.length > 0
                ? `${selectedHashes.length} of ${items.length} selected`
                : "Select all"}
            </span>
          </label>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy || selectedHashes.length === 0}
              onClick={() => void bulkReview(true)}
            >
              Mark reviewed
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkBusy || selectedHashes.length === 0}
              onClick={() => void bulkReview(false)}
            >
              Unmark
            </Button>
            <BulkDeleteButton
              count={selectedHashes.length}
              disabled={bulkBusy || selectedHashes.length === 0}
              onConfirm={bulkDelete}
            />
          </div>
        </div>
      ) : null}

      {items.length === 0 && !loading && !error ? (
        <p className="text-sm text-muted-foreground">No media.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map((item) => (
          <MediaCard
            key={item.hash}
            origin={origin}
            wallet={wallet}
            item={item}
            selected={selected.has(item.hash)}
            onSelectChange={setSelection}
            onReviewed={markReviewedLocally}
            onRemoved={removeLocally}
          />
        ))}
      </div>

      <div className="flex justify-center">
        {hasMore ? (
          <Button variant="outline" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        ) : loading ? (
          <span className="text-sm text-muted-foreground">Loading…</span>
        ) : null}
      </div>
    </div>
  );
}

/** Bulk-delete trigger + confirm (optional audit reason), modeled on the per-card delete dialog. */
function BulkDeleteButton({
  count,
  disabled,
  onConfirm,
}: {
  count: number;
  disabled: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="destructive" disabled={disabled}>
          Delete selected
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {count} media object(s)?</AlertDialogTitle>
          <AlertDialogDescription>
            Deletes blob + metadata for every selected object. A re-upload re-creates them, so block
            the owner for repeat abuse.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="bulk-reason">Reason (audit log)</Label>
          <Input
            id="bulk-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="optional"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void onConfirm(reason.trim())}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The owner's profile name + emoji avatar (resolved from this server), falling back to the raw DID.
 * `detailed` lays it out for a row about the person: a larger avatar, the name, their handles and the
 * DID, which an operator needs beside the name to act on the account.
 */
export function OwnerLabel({
  origin,
  did,
  detailed = false,
}: {
  origin: string;
  did: string;
  detailed?: boolean;
}) {
  const { data } = useProfile(origin, did);
  const emoji = avatarEmoji(data?.avatar);
  if (detailed)
    return (
      <div className="flex min-w-0 items-center gap-2">
        {emoji ? (
          <span aria-hidden className="text-xl">
            {emoji}
          </span>
        ) : null}
        <div className="min-w-0">
          {data?.displayName ? (
            <p className="truncate text-sm font-medium">{data.displayName}</p>
          ) : null}
          {data?.handles?.length ? (
            <p className="truncate text-xs text-muted-foreground">{data.handles.join(", ")}</p>
          ) : null}
          <Did value={did} />
        </div>
      </div>
    );
  if (data?.displayName)
    return (
      <span className="inline-flex items-center gap-1 truncate text-xs" title={did}>
        {emoji ? <span aria-hidden>{emoji}</span> : null}
        <span className="truncate">{data.displayName}</span>
      </span>
    );
  return <Did value={did} />;
}

/**
 * A 16:9 content-addressed thumbnail (most uploads are 16:9): the image for `image/*` (public GET),
 * click-to-open a full-size preview dialog; an icon otherwise or on load error.
 */
function Thumb({ origin, item }: { origin: string; item: MediaListItem }) {
  const [failed, setFailed] = useState(false);
  const src = `${origin}/media/${item.hash}`;
  const isImage = item.type.startsWith("image/");
  if (isImage && !failed)
    return (
      <Dialog>
        <DialogTrigger asChild>
          {/* A plain <img>, not next/image: the src is content-addressed on an arbitrary remote server
              (no Next image loader/domain allowlist applies), and the bytes are immutable + cache-immortal. */}
          <button
            type="button"
            className="block aspect-video w-full cursor-zoom-in overflow-hidden rounded-md bg-muted"
          >
            <img
              src={src}
              alt=""
              onError={() => setFailed(true)}
              className="h-full w-full object-cover"
            />
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate font-mono text-sm">{item.hash}</DialogTitle>
            <DialogDescription>
              {item.type} · {formatBytes(item.size)}
            </DialogDescription>
          </DialogHeader>
          <img
            src={src}
            alt=""
            className="max-h-[75vh] w-full rounded-md bg-muted object-contain"
          />
        </DialogContent>
      </Dialog>
    );
  return (
    <div className="flex aspect-video w-full items-center justify-center rounded-md bg-muted text-muted-foreground">
      {item.type.startsWith("audio/") ? (
        <FileAudioIcon className="size-8" />
      ) : (
        <ImageOffIcon className="size-8" />
      )}
    </div>
  );
}

function MediaCard({
  origin,
  wallet,
  item,
  selected,
  onSelectChange,
  onReviewed,
  onRemoved,
}: {
  origin: string;
  wallet: Wallet;
  item: MediaListItem;
  selected: boolean;
  onSelectChange: (hash: string, on: boolean) => void;
  onReviewed: (hash: string, reviewedAt: string | null, reviewedBy: string | null) => void;
  onRemoved: (hash: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const isReviewed = item.reviewedAt !== null;

  const toggleReview = async () => {
    setBusy(true);
    try {
      const res = await reviewMedia(origin, wallet, item.hash, !isReviewed);
      onReviewed(item.hash, res.reviewedAt, res.reviewedBy);
      toast.success(isReviewed ? "Marked unreviewed" : "Marked reviewed");
    } catch (err) {
      toast.error(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    setBusy(true);
    try {
      const gone = await removeMedia(origin, wallet, item.hash, reason.trim() || undefined);
      if (gone) {
        onRemoved(item.hash);
        toast.success("Removed");
      } else {
        toast.warning("Not found (already gone?)");
      }
    } catch (err) {
      toast.error(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="relative">
        <div className="absolute top-2 left-2 z-10">
          <Checkbox
            aria-label="Select media object"
            checked={selected}
            onCheckedChange={(c) => onSelectChange(item.hash, c === true)}
            className="border-background/60 bg-background/80 shadow-sm backdrop-blur-sm"
          />
        </div>
        <Thumb origin={origin} item={item} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{item.type}</span>
        {isReviewed ? (
          <ToneBadge tone="ok">reviewed</ToneBadge>
        ) : (
          <ToneBadge tone="warn">unreviewed</ToneBadge>
        )}
      </div>
      <Did value={item.hash} />
      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <dt>size</dt>
        <dd className="text-right text-foreground">{formatBytes(item.size)}</dd>
        <dt>uploaded</dt>
        <dd className="text-right text-foreground">
          {new Date(item.uploadedAt).toLocaleDateString()}
        </dd>
        <dt>owner</dt>
        <dd className="flex justify-end overflow-hidden">
          <OwnerLabel origin={origin} did={item.owner} />
        </dd>
      </dl>
      <div className="mt-auto flex gap-2 pt-1">
        <Button
          size="sm"
          variant="secondary"
          className="grow"
          disabled={busy}
          onClick={toggleReview}
        >
          {isReviewed ? "Unmark" : "Mark reviewed"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive" disabled={busy}>
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this media object?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-mono break-all">{item.hash}</span>
                <br />
                Deletes blob + metadata. A re-upload re-creates it, so block the owner for repeat
                abuse.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`reason-${item.hash}`}>Reason (audit log)</Label>
              <Input
                id={`reason-${item.hash}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="optional"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void del()}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
