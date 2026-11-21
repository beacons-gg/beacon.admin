# Beacon operator console

Beacon is a network of servers for games played at real places. The console runs at
[console.beacons.gg](https://console.beacons.gg), and [the console docs](https://beacons.gg/docs/operator-console)
walk through each screen. [Beacon Hosting](https://beacons.gg/hosting) runs a server for you, and
[beacons.gg/docs](https://beacons.gg/docs) covers the rest of Beacon.

The web console an operator runs Beacon servers from, and the contract a game's operator screens
plug into it with. Two packages:

| Path                    | Package                   | What it is                                                                                                                                                                         |
| ----------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin`            | `@beaconsgg/admin`        | the Next.js console: a browser-held wallet signs every admin request to a list of servers; its own [README](apps/admin/README.md)                                                  |
| `packages/admin/plugin` | `@beaconsgg/admin-plugin` | the plugin contract: what a game's operator screens are (`GamePlugin`) and what the console hands them (`AdminHost`); published; its own [README](packages/admin/plugin/README.md) |

The console is game-agnostic, and this repository names no game. A game ships its operator screens
as a plugin package named `@<game>/beacon-admin-plugin` and builds that package against
`@beaconsgg/admin-plugin`. A console deployment names the plugins it carries when it builds. The
build installs them and lists them in `apps/admin/plugins.ts`
([apps/admin/README.md, "Game plugins"](apps/admin/README.md#game-plugins)).

## What it takes from Beacon

From the public npm registry, with no token:

- the client side of the platform at `^1.0.0`: `@beaconsgg/client-sdk`, `@beaconsgg/protocol-types`,
  `@beaconsgg/identity` and `@beaconsgg/geo`. Beacon versions these four together with three more
  packages that the game plugin brings in.
- the presets Beacon's own repositories build with: `@beaconsgg/tsconfig`, `@beaconsgg/vitest-config`,
  `@beaconsgg/eslint-config` and `@beaconsgg/prettier-config`.

## Working here

- **Node 22** (`.nvmrc`; `nvm use`) and **pnpm 10.33** (`corepack enable` picks it up from
  `packageManager`).
- `pnpm install`, then:

```sh
pnpm run gate                       # everything CI runs (below)
pnpm --filter @beaconsgg/admin dev     # the console at http://localhost:3100
pnpm --filter @beaconsgg/admin test    # its suites (vitest, jsdom)
pnpm run build                      # turbo: the plugin contract to dist/, then next build
pnpm run format                     # prettier --write .
```

Add the console's origin to each server's `BEACON_CORS_ORIGINS` (or set it to `*`), and the wallet's
account DID to its `BEACON_ADMINS`.

## The quality bar

The gate (`package.json` > `scripts.gate`) is what `.github/workflows/ci.yml` runs on every PR and
on `main`, in this order:

- **Every suite reports coverage and holds a floor** (`beacon-check-coverage-tasks`, from
  `@beaconsgg/vitest-config`). The repo floor is 81 lines. The console carries its own floor of 21
  in `apps/admin/vitest.config.ts`. That floor sits a little under what the console measures and
  rises one panel at a time.
- **The tier gate** (`beacon-check-tier-gate` from `@beaconsgg/eslint-config`): no game app lints
  itself here, so the tier gate has nothing to check and says so. The tier rules themselves run in
  the lint step: the console imports no server package and no game except a plugin, in `plugins.ts`;
  the contract imports no game and not the console. `beacon.foreign.games` in the root
  `package.json` names every game plugin by the pattern `@*/beacon-admin-plugin`. That pattern is
  how the lint knows that a plugin a deployment adds belongs to a game.
- **No reference a public reader can't open** (`beacon-check-internal-refs` from
  `@beaconsgg/eslint-config`, as `pnpm run check:refs`). The check reads every file git tracks and
  fails on issue numbers, private docs, plan wording and people's names. The organization's own
  names and registry are listed but allowed (`--allow org-names`) until the repository moves to the
  public organization. `beacon.internalRefs` in the root `package.json` names that organization
  (`publicOrg`) and the docs of other repositories that are published (`publishedDocs`). The check
  knows no private names of its own: `privatePatterns` in the same object lists the organization's
  names and registry, the unpublished docs and people's names. The `people` list also holds the
  private product, hosting and infrastructure names. That rule is never allowed, so any of those
  names fails the gate. The `allow` list holds the copyright holder's legal name, which is never a
  finding.
- **Public text passes the copy check** (`beacon-check-copy --strict` as `pnpm run check:copy`).
  The check reads every Markdown file git tracks. A warning fails the gate as well as an error.
- **The contract's public API is written down** (`scripts/check-public-api.mjs`,
  `packages/admin/plugin/public-api.txt`): a removed or renamed name is a major version.
- **One copy of the contract** (`scripts/check-contract-copies.mjs`): a game plugin names
  `@beaconsgg/admin-plugin` as a peer, so it resolves to the console's copy and reads the host context
  the console provides. A second copy under `node_modules/.pnpm` would break every plugin screen at
  runtime and nothing else would notice.
- Then come the build and typecheck (`next build` included) and the suites with coverage. Lint and
  the format check close the gate.

A PR's title says in a sentence what a consumer of `@beaconsgg/admin-plugin` will notice: it is the
release notes.

## Releasing the plugin contract

Merging to `main` validates and ships nothing. A release is one run of
[`.github/workflows/release.yml`](.github/workflows/release.yml) on `main` with a version:

```
gh workflow run release.yml -f version=1.0.1
```

The run sets that version on `@beaconsgg/admin-plugin` and runs the whole gate. Next the run pushes
the commit `Release <version>` to `main`. The run then builds and publishes the package if the
registry lacks that version and points `latest` at the version. Last the run tags `v<version>` and
creates the GitHub Release on the tag, with notes generated from the PRs merged since the previous
release. A run that did not finish is run again with the same version. The same workflow releases
Beacon's packages in [beacon.core](https://github.com/beacons-gg/beacon.core).

The contract has a version of its own, with the rules in
[beacon.core's `doc/core-compatibility.md` §8](https://github.com/beacons-gg/beacon.core/blob/main/doc/core-compatibility.md).
From `1.0.0` the version follows semantic versioning. A major release removes or renames a name in
`public-api.txt`, adds a required member to `GamePlugin` or moves the three core peers under the
contract's types to a new major. A new member of `AdminHost`, a new optional member of `GamePlugin`
and a new optional component prop are minor releases. A fix is a patch. A deprecated name keeps
working for at least one minor release and goes in a major at the earliest. A major comes first as
candidates (`2.0.0-rc.1`) under the `next` dist-tag.

[`CHANGELOG.md`](CHANGELOG.md) says what a plugin has to change. The changelog has an entry for each
major and each deprecation, and a major's entry comes with its first candidate.

The console itself (`@beaconsgg/admin`) is private and never published.

## Deploying the console

The console ships as a Docker image, `beacon-admin`, pushed to the container registry by the
Release workflow as `<version>` and `latest`. The console is a Next.js app with no server-side
state. The Next server is a static shell, and every request a server sees is signed in the browser.
The servers an operator manages are entered at runtime. So the container takes **no configuration**;
the one thing the build needs is the registry config, mounted as a BuildKit secret (never a build
argument or a layer). The config carries the registry token when the registry needs one. The game
plugins the console carries are chosen at build time
([apps/admin/README.md, "Game plugins"](apps/admin/README.md#game-plugins)). The console reads
listings from the server directory at `https://beacons.gg` by default. Each operator can
change that address in the browser
([apps/admin/README.md, "Settings kept in the browser"](apps/admin/README.md#settings-kept-in-the-browser)).

Run it:

```bash
docker compose up --build                      # built from this checkout, http://localhost:3100
docker run --rm -p 3100:3100 ghcr.io/beacons-gg/beacon-admin:latest   # a released image
```

Pair it with a server, once per server:

1. Create or import a wallet under **Wallet** in the console. Unlock the wallet and copy its account
   DID.
2. On the server set `BEACON_ADMINS` to that DID. While the setting is empty the admin surface does
   not exist and the admin routes answer 404. Add the console's origin to `BEACON_CORS_ORIGINS`
   (`http://localhost:3100` for a local run) or set that variable to `*`. An empty
   `BEACON_CORS_ORIGINS` allows no cross-origin request, and the console cannot reach the server.
   Restart the server.
3. Add the server by origin under **Servers** in the console. The console fetches and verifies the
   server's signed descriptor. The dashboard, places, settings and game screens then work against
   that server.

CI builds the image on every PR and merge without pushing it; the Release pushes it before writing
the tag and the GitHub Release, so an image exists for every listed version.

## Contributing

The project doesn't accept pull requests from outside contributors yet. Issues are welcome, and a
vulnerability goes through GitHub's private vulnerability reporting ([SECURITY.md](SECURITY.md)).
[CONTRIBUTING.md](CONTRIBUTING.md) has the details, how the project is built and how to write a
console plugin.

## License

The console and the plugin contract are licensed under the Apache License 2.0 ([LICENSE](LICENSE)).
NorthCtrl LLC holds the copyright, as [NOTICE](NOTICE) states.

## History

The code was developed inside an earlier Beacon monorepo until October 2026 and moved here with its
history. An issue or pull request number in an older commit message refers to that repository,
which is archived and was never public. Beacon's published packages continue in
[beacon.core](https://github.com/beacons-gg/beacon.core).
