import type { AdminSetting } from "@beaconsgg/protocol-types";

/** A runtime setting on its built-in default, so each case states only what it changes. */
export const setting = (over: Partial<AdminSetting> = {}): AdminSetting => ({
  key: "mailboxTtlSeconds",
  env: "BEACON_MAILBOX_TTL",
  editable: true,
  provenance: "env",
  configured: false,
  value: 604800,
  ...over,
});
