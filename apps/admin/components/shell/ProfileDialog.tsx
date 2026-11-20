"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/primitives";
import { trustRefusal, useAnyServer, useServers } from "@/features/servers";
import { useWallet } from "@/features/wallet";
import { loadOperatorFace, publishOperatorProfile } from "@/features/wallet/profileApi";
import { describeApiError } from "@/lib/api";

/**
 * The operator's public face: the name + emoji avatar players see on anything
 * this account organized (an operator challenge's byline, room attributions). Prefilled from
 * the best published copy across the saved fleet; Publish posts the bumped doc to every server
 * so attribution resolves wherever a challenge lives.
 */
export function ProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { wallet } = useWallet();
  const known = useServers();
  // A server now signing with a different key, or not yet checked this session, is not published to
  // or read from: the doc is public, but the console doesn't know who holds that origin. Nor is the
  // quick-view server, which the operator chose not to keep.
  const servers = known.servers.filter(
    (s) => trustRefusal(s, known) === undefined && s.origin !== known.preview,
  );
  // The prefill reads this list without depending on it: checks land one server at a time, and a refetch
  // on each would wipe what the operator has typed. It waits for the first checked server instead.
  const prefillFrom = useRef(servers);
  prefillFrom.current = servers;
  const anyChecked = servers.length > 0;
  // Publishing fans out over the whole saved fleet, so it takes the fan-out gate rather than a
  // seventh hand-rolled "is there anywhere to publish" check. Rendered as a hint beside a disabled
  // button rather than in place of the dialog: the form is still worth reading while locked.
  const fleet = useAnyServer({ wallet: "publishing signs a write to every saved server" });
  const gate: typeof fleet =
    !fleet.ok || anyChecked
      ? fleet
      : {
          ok: false,
          refusal:
            known.checking.length > 0
              ? "Waiting for a saved server's identity to be checked."
              : "Every saved server now signs with a different key. Add one's origin again on the Servers page to publish to it.",
        };
  // One state for one thing: the editable face, null while the fleet prefill is in flight.
  const [face, setFace] = useState<{ displayName: string; avatarEmoji: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill from the fleet's best copy each time the dialog opens (a stale prefill would
  // silently roll back edits made elsewhere). Publishing re-reads the fleet it posts to before the
  // version bump, so a server checked after the prefill is still not clobbered.
  useEffect(() => {
    if (!open || !wallet) return;
    let cancelled = false;
    setFace(null);
    if (!anyChecked) return;
    void loadOperatorFace(
      prefillFrom.current.map((s) => s.origin),
      wallet.account.did,
    ).then((loaded) => {
      if (!cancelled) setFace(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [open, wallet, anyChecked]);

  const publish = async () => {
    if (!wallet || !face || busy) return;
    setBusy(true);
    try {
      const outcomes = await publishOperatorProfile(
        servers.map((s) => s.origin),
        wallet,
        face,
      );
      const failed = outcomes.filter((o) => !o.ok);
      if (failed.length === 0) {
        toast.success(
          `Profile published to ${outcomes.length} server${outcomes.length === 1 ? "" : "s"}.`,
        );
        onOpenChange(false);
      } else {
        toast.error(
          `Published to ${outcomes.length - failed.length} of ${outcomes.length} — failed: ${failed
            .map((f) => `${f.origin} (${f.error})`)
            .join(", ")}`,
        );
      }
    } catch (err) {
      // The builder refuses a doc over the size cap before anything is sent, and says by how much.
      toast.error(`Publish failed: ${describeApiError(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Operator profile</DialogTitle>
          <DialogDescription>
            The name and face players see on anything this account organizes — challenge bylines,
            room attributions. Published to every saved server.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Display name">
            <Input
              value={face?.displayName ?? ""}
              onChange={(e) => setFace((f) => f && { ...f, displayName: e.target.value })}
              placeholder="North Control"
              disabled={face === null}
            />
          </Field>
          <Field label="Avatar emoji">
            <Input
              value={face?.avatarEmoji ?? ""}
              onChange={(e) => setFace((f) => f && { ...f, avatarEmoji: e.target.value })}
              placeholder="🦊"
              maxLength={8}
              disabled={face === null}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={face === null || busy || !gate.ok} onClick={() => void publish()}>
              {busy ? "Publishing…" : "Publish"}
            </Button>
          </div>
          {gate.ok ? null : <p className="text-xs text-muted-foreground">{gate.refusal}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
