"use client";

import { GlobeIcon, Trash2Icon, XIcon } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Did, ToneBadge } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { AddServerForm } from "./AddServerForm";
import { serverLabel } from "./label";
import { useServerRoles } from "./roles";
import { useServers } from "./ServersProvider";

/** The selectable-row look shared by the "All servers" row and each server row. */
const rowClass = (active: boolean) =>
  cn(
    "w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors",
    active ? "border-gold/50 bg-gold/8" : "border-border hover:border-foreground/20",
  );

/**
 * Manage the server list: add by origin (descriptor-verified), select one or "all", remove. A server
 * the wallet is not an admin of is marked, and the quick-view one (added without being an admin, so
 * never saved) closes rather than being removed.
 * `initialInput` seeds the add field (a link from elsewhere, such as a hosting dashboard, carries
 * the server's address).
 */
export function ServersPanel({ initialInput }: { initialInput?: string | undefined } = {}) {
  const s = useServers();
  const roles = useServerRoles();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Servers</CardTitle>
        <CardDescription>
          Add a server by origin. Its signed descriptor is fetched and verified first. A server you
          are not an admin of opens as a quick view and is not saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AddServerForm initialInput={initialInput} />

        {s.servers.length > 0 ? (
          <ul className="space-y-2">
            <li>
              <button
                className={rowClass(s.active === undefined)}
                onClick={() => s.setActive(undefined)}
              >
                <GlobeIcon className="mr-2 inline size-4 align-text-bottom text-muted-foreground" />
                All servers <span className="text-muted-foreground">({s.servers.length})</span>
              </button>
            </li>
            {s.servers.map((server) => {
              const preview = s.preview === server.origin;
              const notAdmin = roles.roleOf(server.origin) === "notAdmin";
              return (
                <li key={server.origin} className="flex items-start gap-2">
                  <div className="grow">
                    <button
                      className={rowClass(s.active === server.origin)}
                      onClick={() => s.setActive(server.origin)}
                    >
                      <span className="font-medium">{serverLabel(server)}</span>{" "}
                      <span className="font-mono text-xs text-muted-foreground">
                        {server.origin}
                      </span>
                      {preview || notAdmin ? (
                        <span className="ml-2 inline-flex align-middle">
                          <ToneBadge tone={preview ? "warn" : "neutral"}>
                            {preview ? "quick view, not saved" : "not an admin"}
                          </ToneBadge>
                        </span>
                      ) : null}
                      <span className="mt-1 flex flex-wrap gap-1">
                        {server.capabilities.map((c) => (
                          <Badge key={c} variant="secondary">
                            {c}
                          </Badge>
                        ))}
                      </span>
                      {s.identityChanged.includes(server.origin) && (
                        // Re-pinning on the operator's say-so only: a descriptor signed by a new key
                        // is either a deliberate rotation or somebody else answering at this origin,
                        // and the console can't tell which. Adding the origin again accepts it.
                        <span className="mt-1 block text-xs text-destructive">
                          Now signing with a different key than the one pinned here, so the console
                          sends it no admin requests. Capabilities and coverage below are the last
                          trusted copy. Add its origin again to trust the new key.
                        </span>
                      )}
                    </button>
                    <div className="mt-1 px-3">
                      <Did value={server.key} />
                    </div>
                  </div>
                  {preview ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Close the quick view of ${serverLabel(server)}`}
                      onClick={() => s.remove(server.origin)}
                    >
                      <XIcon className="size-4" />
                    </Button>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${serverLabel(server)}`}
                        >
                          <Trash2Icon className="size-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove {serverLabel(server)}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Drops this server from the console. Nothing on the server changes — you
                            can re-add it by origin anytime.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => {
                              s.remove(server.origin);
                              toast.success(`Removed ${serverLabel(server)}`);
                            }}
                          >
                            Remove
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No servers yet. Add one by origin to get started.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
