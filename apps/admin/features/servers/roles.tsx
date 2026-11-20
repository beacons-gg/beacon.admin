"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { trustRefusal } from "./gate";
import { roleFrom, type ServerRole } from "./role";
import { useServers } from "./ServersProvider";
import { useAdminStatus } from "./useAdminStatus";

/** Each server's role for the unlocked wallet (`role.ts`), kept current for every screen. */
export interface ServerRoles {
  roleOf(origin: string): ServerRole;
  /**
   * Whether the wallet may be an admin of `origin`: anything but a known "not an admin". A role still
   * unknown keeps a server's admin controls, as before roles existed; the server refuses the op anyway.
   */
  mayAdmin(origin: string): boolean;
  /** The origins where the wallet is known not to be an admin. */
  notAdmin: readonly string[];
}

const NO_ROLES: ServerRoles = { roleOf: () => "unknown", mayAdmin: () => true, notAdmin: [] };
const RolesContext = createContext<ServerRoles>(NO_ROLES);

/**
 * Keeps each server's role current. One invisible probe per trusted server reads the same SWR key as
 * the dashboard, the lock banner and the Explore ribbon, so the role costs no request of its own. A
 * server whose identity is unchecked or changed gets no probe, since no admin request goes to it.
 */
export function ServerRolesProvider({ children }: { children: ReactNode }) {
  const known = useServers();
  const { preview } = known;
  const [roles, setRoles] = useState<Readonly<Record<string, ServerRole>>>({});
  const report = useCallback((origin: string, role: ServerRole) => {
    setRoles((prev) => (prev[origin] === role ? prev : { ...prev, [origin]: role }));
  }, []);
  const probed = known.servers.filter((s) => trustRefusal(s, known) === undefined);

  const origins = probed.map((s) => s.origin).join(" ");
  const value = useMemo<ServerRoles>(() => {
    const live = new Set(origins.split(" "));
    const roleOf = (origin: string): ServerRole => {
      if (!live.has(origin)) return "unknown";
      const role = roles[origin] ?? "unknown";
      // The quick-view server said "not an admin" when it was added, which holds until a read
      // says more: its probe reports `unknown` while its first status read is in flight.
      return role === "unknown" && origin === preview ? "notAdmin" : role;
    };
    return {
      roleOf,
      mayAdmin: (origin) => roleOf(origin) !== "notAdmin",
      notAdmin: [...live].filter((origin) => roleOf(origin) === "notAdmin"),
    };
  }, [roles, origins, preview]);

  return (
    <RolesContext.Provider value={value}>
      {probed.map((s) => (
        <RoleProbe key={s.origin} origin={s.origin} onRole={report} />
      ))}
      {children}
    </RolesContext.Provider>
  );
}

function RoleProbe({
  origin,
  onRole,
}: {
  origin: string;
  onRole: (origin: string, role: ServerRole) => void;
}) {
  const role = roleFrom(useAdminStatus(origin));
  useEffect(() => onRole(origin, role), [origin, role, onRole]);
  return null;
}

/** Each server's role. Outside the provider every role is `unknown`, which changes nothing. */
export function useServerRoles(): ServerRoles {
  return useContext(RolesContext);
}
