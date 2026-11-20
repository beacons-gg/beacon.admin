"use client";

import type { ReactNode } from "react";
import { serverLabel } from "./label";
import type { SavedServer } from "./registry";

/** The standard refusal line: a gated surface renders this instead of its content. */
export function GateNotice({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * The "you are working on this one" line above a single-server surface. The verb is the caller's
 * (`Moderating`, `Curating`), the server's name and origin are not, so an operator reads the same
 * shape on every screen and can tell at a glance which box a signed op is about to hit.
 */
export function ActiveServerLine({
  server,
  children,
}: {
  server: SavedServer;
  children: ReactNode;
}) {
  return (
    <ServerLine label={serverLabel(server)} origin={server.origin}>
      {children}
    </ServerLine>
  );
}

/** {@link ActiveServerLine} for a server already labelled: a game plugin's, which has no saved record. */
export function ServerLine({
  label,
  origin,
  children,
}: {
  label: string;
  origin: string;
  children: ReactNode;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      {children} <span className="font-medium text-foreground">{label}</span> —{" "}
      <span className="font-mono">{origin}</span>
    </p>
  );
}
