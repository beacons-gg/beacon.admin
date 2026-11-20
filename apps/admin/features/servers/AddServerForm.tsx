"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { describeApiError } from "@/lib/api";
import { useWallet } from "@/features/wallet";
import { serverLabel } from "./label";
import type { SavedServer } from "./registry";
import { useServers } from "./ServersProvider";

/**
 * Add a server by its address: the descriptor is fetched and verified before it joins. `initialInput`
 * seeds the field and goes no further: nothing is added until the operator presses Add. The address
 * goes to `add` as it stands, so a server reached by its slug keeps that address.
 *
 * A server the wallet is not an admin of opens as a quick view instead of joining the list, and
 * becomes the selected server so the operator sees it straight away.
 */
export function AddServerForm({
  initialInput,
  onAdded,
}: {
  initialInput?: string | undefined;
  onAdded?: (server: SavedServer) => void;
}) {
  const { add, setActive } = useServers();
  const { wallet } = useWallet();
  const [input, setInput] = useState(initialInput ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { server, preview } = await add(input, wallet);
      setInput("");
      if (preview) {
        setActive(server.origin);
        toast.info(`Opened ${serverLabel(server)} as a quick view`, {
          description:
            "You are not one of its admins, so it is not saved to your servers. Its public map and details stay open until you reload.",
        });
      } else toast.success(`Added ${serverLabel(server)}`);
      onAdded?.(server);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (input && !busy) void submit();
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://beacon.example  or  192.168.10.10:3001"
        />
        <Button type="submit" disabled={!input || busy}>
          {busy ? "Verifying…" : "Add"}
        </Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
