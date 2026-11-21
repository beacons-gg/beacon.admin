# Develop the console

This page is for the maintainers. The [README](../README.md) covers the setup and the everyday
commands. This page covers what the console takes from Beacon Core and the checks in the gate.

## What the console takes from Beacon

From the public npm registry, with no token:

- the client side of the platform at `^1.0.0`: `@beaconsgg/client-sdk`, `@beaconsgg/protocol-types`,
  `@beaconsgg/identity` and `@beaconsgg/geo`. Beacon versions these four together with three more
  packages that the game plugin brings in.
- the presets Beacon's own repositories build with: `@beaconsgg/tsconfig`, `@beaconsgg/vitest-config`,
  `@beaconsgg/eslint-config` and `@beaconsgg/prettier-config`.

## The quality bar

The gate (`package.json` > `scripts.gate`) is what `.github/workflows/ci.yml` runs on every pull request
marked ready, in this order:

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
  names and registry are listed but allowed (`--allow org-names`). `beacon.internalRefs` in the root `package.json` names that organization
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
