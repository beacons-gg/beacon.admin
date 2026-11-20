# @beaconsgg/admin-plugin

The seam between the Beacon operator console (`apps/admin`) and a game's operator screens.

The console is game-agnostic. A game that wants operator screens ships them as a **`GamePlugin`**
(`slug`, `label`, `icon`, `Screen`, and optionally names for its room types) from a package named
`@<game>/beacon-admin-plugin`. A console deployment names the plugins it carries when it builds, and
the console renders each at `/games/<slug>`
(see [Game plugins](../../../apps/admin/README.md#game-plugins) in the console's README). A plugin
depends on this package and never on the console, so the console builds with no game in it and a
game builds with no console in it.

A plugin package exports one `GamePlugin`, under any name. The console imports the package's entry
whole and finds the plugin among its exports, so the entry exports the plugin and little else:
whatever else it exports is bundled into the console too.

```tsx
// @example/beacon-admin-plugin, src/index.ts
import type { GamePlugin } from "@beaconsgg/admin-plugin";
import { FlagIcon } from "lucide-react";
import { ExampleScreen } from "./ExampleScreen.js";

export const examplePlugin: GamePlugin = {
  slug: "example", // the game's slug: the console signs the screen's writes as this game
  label: "Example",
  icon: FlagIcon,
  Screen: ExampleScreen,
  roomTypes: { crate: { label: "Crate", color: "#0ea371" } },
};
```

```tsx
// src/ExampleScreen.tsx
"use client";
import { useAdminHost } from "@beaconsgg/admin-plugin";

export function ExampleScreen() {
  const { useSession, ui } = useAdminHost();
  const session = useSession({ server: "its crates are per server", wallet: "to sign as its admin" });
  if (!session.ok) return <ui.GateNotice>{session.refusal}</ui.GateNotice>;
  return (
    <ui.Panel title="Crates">
      <ui.ActiveServerLine server={session.server}>Managing crates on</ui.ActiveServerLine>
    </ui.Panel>
  );
}
```

The plugin package names this one as a peer dependency together with React and the three core
packages below. The console's copy is then the one the plugin reads. The plugin package ships built
ES modules and keeps each screen's `"use client"` directive as the module's first statement.

Inside a plugin screen, `useAdminHost()` returns the **`AdminHost`** the console provides:

| Member                              | What it is                                                          |
| ----------------------------------- | ------------------------------------------------------------------- |
| `useSession(need)`                  | the active server and the unlocked wallet, or the refusal to show. The server carries `origin`, `label` and `coverage` |
| `client`                            | a `@beaconsgg/client-sdk` client configured like the console's, signing as the plugin's game (its `slug`) and reading that game's content by default |
| `uploadPlacePhoto` and `removeRoom` | the signed calls a game screen needs (`media.put`, `admin.room.remove`) |
| `describeError`, `copyText` and `toast`| the console's error sentence, clipboard and toasts. `describeError` reads an `ApiError`'s `code`: for a 403 `gameNotAdmitted` (the server does not admit the plugin's game) and a locked server's `writeLocked` it says so in the console's words. A game-facing call gets a `gameNotAdmitted` refusal as its answer in the server's words, so a plugin that wants the console's sentence checks `result.error` and passes `new ApiError(403, result.message ?? "", result.error)` to `describeError` |
| `ui`                                | the console's components: buttons, inputs, selects, tabs, tables and panels. The set also holds the gate notice and a point-picking map |

The console guarantees the component props that this package declares. A plugin that needs another
prop adds the prop here, and the console's typecheck proves the components still fit.

Since 1.0.0 the core peers are `^1.0.0`, which every 1.x release of core satisfies. A plugin calls
the console's own copy of the SDK through `client`, so build the plugin against core 1.0 on Node 22
or later. The [changelog](../../../CHANGELOG.md) lists what a plugin changes to move from the
contract's 0.4.

The package holds types plus one React context (`AdminHostContext`); React is a peer dependency. The
package is built as ES modules (`"type": "module"`) so the `"use client"` directive stays the
module's first statement for Next.

The contract is published to npm on a version of its own, so a game's plugin
installs the contract wherever the game is developed. Section 8 of
[beacon.core's `doc/core-compatibility.md`](https://github.com/beacons-gg/beacon.core/blob/main/doc/core-compatibility.md)
states what the contract promises. The package's names are the public API in `public-api.txt`. A
major release removes or renames a name, adds a required member to `GamePlugin` or moves the core
peers to a new major. A new member of `AdminHost` is a minor release. `@beaconsgg/client-sdk`,
`@beaconsgg/identity` and `@beaconsgg/protocol-types` are peer dependencies like React. The
contract's types are written in them, and a plugin and the console each install them anyway. The
types a plugin sees are therefore the host's own copy of the SDK.
