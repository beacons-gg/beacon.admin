# @beaconsgg/admin: the operator console

The operator console is a **Next.js (App Router)** web app that manages a **list of Beacon servers
from one pane of glass**. Each server gets a dashboard over the signed `admin.status` read and a
places curation surface: snapshots, conflict review, per-field edits and `beacon-places/1` export
and import. The map shows every server at once. The server's admin API spec (beacon.server
`doc/spec/admin-api.md`) describes the routes the console calls.

**The auth model is the platform's auth model.** There are no tokens, sessions or server-side
accounts. The console holds a standard Beacon wallet **in the browser** and signs every admin
request as an `OpEnvelope` through Beacon's shared client packages. Those packages are
`@beaconsgg/identity` and `@beaconsgg/protocol-types`, the same code the game client ships. Each
server independently checks the signer against its own `BEACON_ADMINS`. The Next server is a static
shell with **no key, no custody and no API routes.**

## Layout (routes thin; logic in features)

- `app/`: **routes, layout and providers only.** Pages are thin server components that render
  feature components; all interactivity is inside the features.
- `components/`: the shared UI primitives (`Card`/`Button`/`Input`/`Badge`…, plain Tailwind).
- `features/`: the domain modules, feature-first like the game client:
  - `onboarding/`: the front door. The console shows nothing until the wallet is unlocked, the way a
    dashboard needs a sign-in. A browser with no wallet saved gets a welcome in four steps. The operator creates an
    identity or restores one from its recovery phrase and backs the phrase up. The welcome then
    shows the DID for `BEACON_ADMINS` and adds a first server. A browser with a locked
    wallet gets an unlock screen and nothing else. Locking from the sidebar returns to the unlock
    screen. The folder also holds the dialog that renews a wallet session that ran out.
  - `wallet/`: create or import the operator identity (BIP39) through `@beaconsgg/client-sdk`'s
    passphrase vault. **At rest** only the passphrase-encrypted phrase sits in localStorage (PBKDF2
    → AES-256-GCM in WebCrypto). Each unlock re-derives the account root and authorizes a **fresh
    device key** for a session that lasts 7 days. A server refuses a request signed after that with
    `badsig`. The console then asks for the passphrase and sends the refused request once more under
    the new session, a game plugin's included (`lib/session.ts`); closing the dialog instead locks
    the wallet.
  - `servers/`: the server list, active-server selection and the "all servers" fan-out targets.
    Adding a server goes by origin: the console fetches and **verifies** the signed descriptor and
    then pins the server's identity, coverage and capabilities. The console keeps the address the
    operator typed even when the descriptor names another host. The folder also holds the shared
    gate that every signed surface renders behind. `useSingleServer` serves a one-box screen and
    `useAnyServer` a fan-out one. The gate asks for a saved server, the scope, an unlocked wallet
    and optionally an advertised capability. Each screen supplies only the clause that says why it
    needs them. `serverLabel` is the one place a server is named on screen in this console. Each
    saved server's identity is re-checked at launch, and no admin request goes to it until its check
    lands; one that can't be reached is tried again every 30 seconds rather than trusted on its
    stored key. A server that now signs with a different key is refused, and the operator is told
    once. The gate, the dashboard and Explore's room removal send that server nothing. The operator
    profile skips the server too. Adding its origin again trusts the new key. A key that changes
    while the console is open is found at the next launch, not before.
    The folder also knows the wallet's role on each server (`role.ts`, `roles.tsx`). A server has
    one role: a DID is on `BEACON_ADMINS` or it isn't. The `admin.status` read every screen already
    polls says which, since a server answers a non-admin `403` and a server with no admins `404`.
    A server the wallet is not an admin of shows no admin control anywhere. The sidebar leaves out
    the admin screens when no server in scope has the wallet as an admin. The single-server gate
    refuses with the reason. The dashboard shows the public descriptor in place of the status.
    Explore offers no room removal. Adding a server the wallet is not an admin of opens it as a
    **quick view**: the server is selected and its public map shows, but the console never saves
    it. A reload, another quick view or closing the quick view on the Servers page ends it.
  - `dashboard/`: `admin.status` cards (SWR, 30s refresh; uptime derived from `startedAt`).
  - `places/`: the curation surface for the server's three place inputs.
    - Runtime **Atlas volume import** from a URL, an uploaded archive or a mounted path. An import
      is inspected and then confirmed, and confirming pins the volume's publisher. The pins audit
      list revokes a binding. Recent runs show their progress and can be canceled.
    - The player-contribution **proposal queue** and the retire-source close-out.
    - The conflict queue (keep mine or accept incoming).
    - Browse by cells, with a per-field set and clear editor over every editable field.
    - A photo manager that resizes and encodes in the browser and uploads through `media.put`. The
      manager can also remove a photo or revert a place to its source photo. The manager needs the
      server's media capability.
    - Export and import, and the Share-contributions export (the operator half of the contribution
      round-trip).
  - `map/`: the **pane-of-glass map** (MapLibre GL). The map shows every game's rooms and scouts
    from `GET /discovery` and places from `GET /places`. Those reads fan out across the target
    servers by viewport cells (`cellsForView`), which are coarsened automatically and bounded by
    cost. Rooms filter and color by the games and room types in view. A game plugin may name its
    room types, and none is needed. Each server has its own stroke color, and a click on a room
    opens an inspector with room removal. The map makes only public reads, so the map works without
    an unlocked wallet. The map uses OSM raster tiles by default and persists a custom style URL. No
    style ever needs a token.
  - `moderation/`: the durable blocklist (block and unblock with reasons; entries seeded from
    `BEACON_BLOCKLIST` are labeled), and the remove-room / remove-media tools. One server at a
    time, wallet required.
  - `settings/`: the server configuration screen over `admin.settings.get`/`set`/`reset`, following
    the server's runtime settings spec (beacon.server `doc/spec/runtime-settings.md` §5). The screen
    shows all 70 fields. A local `catalog.ts` groups and types the 42 editable ones. The 28
    deploy-time fields sit read-only beside them and name the variable and the restart. Secrets
    show only as set or unset. Edits collect in a buffer and go as **one signed write**. The
    settings constrain each other, so changing one key at a time walks an operator into a refusal
    in whichever order they try. A write answers with the whole configuration, which replaces the
    cache outright since a write can move a field it was never sent. Refusals arrive as one
    `ZodError` keyed by setting, so each lands under its own row.
  - `directory/`: the **Server directory** card at the foot of the settings screen, shown only when
    the wallet is an admin of the server. The card says whether the directory lists the server
    (`GET <directory>/api/v1/servers/<host>`) and offers **Remove listing**. Removal asks the
    directory for a one-time nonce. The console signs `admin.status` with params `{}` and that nonce
    and sends the envelope to the directory. The directory forwards the envelope to the server's own
    `POST /admin/status`, and a `200` there proves the wallet is on `BEACON_ADMINS`. A listing that
    the hosting dashboard keeps is removed there instead, and the card shows the directory's
    message saying so. The directory address is a setting kept in this browser (below,
    "Settings kept in the browser").
  - `lock/`: the write lock. `writeLocked` is an ordinary runtime setting set through
    `admin.settings.set`. The folder holds a Lock / Unlock control with a confirmation on each
    server's status card, and the banner on every page while the selected server is locked. The
    banner reads the shared `admin.status` poll. Like every signed read the banner needs an unlocked
    wallet and a checked server. The banner shows nothing in the all-servers scope.
  - `backup/`: back a server up to an S3 prefix and restore one from it, over `admin.backup.*` and
    `admin.restore.*`. Both stay available on a locked server. Each run is durable and followed by
    id, through the restart a restore ends with. Only where the backups live is remembered per
    server in this browser; the S3 access key and secret are typed in each time and kept only in
    memory. Like `/servers`, `/backup?add=<origin>` offers a server to add. The page selects that
    server once added.
  - `games/`: the host that the console hands every game plugin (`@beaconsgg/admin-plugin`'s
    `AdminHost`). The host carries the console's single-server gate and a client that signs as the
    plugin's game (by its slug). The host also carries the photo upload, room removal and the
    console's own components. A plugin's screens therefore behave and look like the console's. The
    folder also holds `GAME_PLUGINS`, the plugins from the packages that `plugins.ts` lists.
- `plugins.ts`: the game plugin packages this build carries, and **the one file in the console that
  may import one** (the lint holds it). The repository lists none; a deployment adds its own when
  it builds (below, "Game plugins").
- `scripts/add-plugins.mjs`: installs a deployment's game plugins and writes `plugins.ts`.
- `lib/` holds the infrastructure. `api.ts` is the console's `@beaconsgg/client-sdk` client with no
  timeout and no game slug. `clientFor(game)` makes a plugin's client. Every feature reaches the
  SDK's throwing calls through `signedPost`, `signedUpload` and `getJson`. `lib/` also holds
  schema-validated localStorage.

**SWR everywhere** for reads: keys are `[resource, origin, account]` (the logical resource, never
an envelope; every request signs a fresh one); writes `mutate()` their reads.

## Game plugins

The console names no game. A game that wants operator screens publishes them as the plugin package
`@<game>/beacon-admin-plugin`, built against `@beaconsgg/admin-plugin`. The contract's
[README](../../packages/admin/plugin/README.md) has an example. A deployment chooses the plugins its
console carries when it builds. A deployment therefore adds a game's screens at build time with no
change to this repository.

Each plugin renders under `/games/<slug>` (`app/games/[slug]`) inside the console's host and gets a
nav entry under **Games**. A console with no plugins has neither: no Games group, and every
`/games/<slug>` is a 404. The repository builds, typechecks and passes its suites with no plugins.
CI checks the repository in that state.

**In the image** the `CONSOLE_PLUGINS` build argument names the plugin packages. Spaces separate the
names, and each name can carry a version range:

```bash
docker build --build-arg CONSOLE_PLUGINS="@example/beacon-admin-plugin@^1.2.0" -t beacon-admin .
CONSOLE_PLUGINS="@example/beacon-admin-plugin" docker compose up --build
```

A plugin on the public npm registry needs no npm config. A plugin from another registry does. Map
the plugin's scope to its registry beside the token in an npm user config, such as
`@example:registry=https://registry.example.com/`. Pass that file to the build as the `npmrc`
secret, which never lands in a layer:

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc \
  --build-arg CONSOLE_PLUGINS="@example/beacon-admin-plugin@^1.2.0" -t beacon-admin .
```

The Release workflow builds its image with an empty `CONSOLE_PLUGINS`, so the released image
carries no game plugin. To run a console with plugins, build your own image as above.

**From a checkout**, the same script the image runs:

```bash
node apps/admin/scripts/add-plugins.mjs @example/beacon-admin-plugin@^1.2.0
```

The script installs each package into the console (`pnpm add`) and then checks two things. No
plugin may bring a second copy of `@beaconsgg/admin-plugin` (`scripts/check-contract-copies.mjs`),
since that plugin's screens would find no host. Each plugin must have its built `dist` where the
styles glob below looks. Last the script writes `plugins.ts`. The script changes `package.json`, the
lockfile and `plugins.ts`. Run the script on a checkout you build from and never commit the result.
A package that does not export exactly one `GamePlugin` fails the build by name.

The name is held to `@<game>/beacon-admin-plugin` because three things key on the name:

- The lint lets only `plugins.ts` import such a package (`beacon.foreign.games` in the root
  `package.json`).
- Tailwind never scans `node_modules`, so `app/globals.css` sources every plugin's built classes
  with one `@source` glob over the name. A glob that matches nothing still builds.
- `app/__tests__/pluginStyles.test.ts` checks that the glob reaches each listed plugin's installed
  `dist`.

## Settings kept in the browser

The console takes no environment configuration. The two outside addresses it calls are settings
an operator changes on screen, saved in the browser's localStorage:

| Setting           | Default                                                      | Where to change it                                                |
| ----------------- | ------------------------------------------------------------ | ----------------------------------------------------------------- |
| Map style         | OpenStreetMap raster tiles                                   | the map's style button                                            |
| Directory address | `https://beacons.gg` (localStorage `beacon-admin.directory`) | **Change directory** on the **Server directory** card in Settings |

The directory address is the origin of the server directory that lists the servers. Point the
setting at another directory when your servers are listed there. Leave the field empty to go back
to the default.

## Run

```bash
pnpm --filter @beaconsgg/admin dev    # http://localhost:3100
```

Add the console's origin to each server's `BEACON_CORS_ORIGINS` or set that variable to `*`. An
empty `BEACON_CORS_ORIGINS` allows no cross-origin request. Add the wallet's account DID to each
server's `BEACON_ADMINS`.

The tests run in `vitest` with jsdom. The suites cover the wallet vault's binding and the server
registry. The suites also cover the signed-request builder and the settings screen rendered against
stubbed ops. The crypto round-trip and the vault itself are tested in `@beaconsgg/client-sdk`. A
browser E2E pass is still deferred until the surface
stabilizes.
