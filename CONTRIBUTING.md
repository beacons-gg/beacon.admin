# Contributing

This repository holds the Beacon operator console (`apps/admin`) and `@beaconsgg/admin-plugin`, the
contract that a game's operator screens are written against. The [README](README.md) describes both
packages and the quality bar that every change has to clear. The console and the plugin contract
are licensed under the Apache License 2.0 ([LICENSE](LICENSE)), and [NOTICE](NOTICE) names the
copyright holder.

## Issues and pull requests

The project doesn't accept pull requests from outside contributors yet. This file will say so when
that changes.

Issues are welcome. Open an issue to report a bug, ask a question or suggest an idea.

Report a vulnerability through GitHub's private vulnerability reporting. Don't open a public issue
for a vulnerability. [SECURITY.md](SECURITY.md) gives the fallback email address and the response
target.

## How the project is built

The rest of this file describes how the maintainers build and change the console and the plugin
contract. The same steps let you build the console yourself, run the gate and follow the fix for
an issue you reported.

## Make a change

1. Create a branch off `main`.
2. Set up the workspace as the README's [Development](README.md#development) section describes.
   You need Node 22 (run `nvm use`) and pnpm 10.33.
3. Make the change with tests that cover the change.
4. Run `pnpm run gate` until the gate passes. CI runs the same script.
5. Open a draft pull request against `main`. A draft runs no CI. Mark the pull request ready for
   review once the gate passes locally, and CI runs the gate once.

The title of a pull request says in one sentence what a user of `@beaconsgg/admin-plugin` or of the
console will notice. The release notes are built from these titles.

`main` is protected. CI must pass before a pull request merges, and nobody pushes to `main`
directly.

## Writing

Public text covers the READMEs, the docs and every word the console shows. Write it in US English,
in plain and exact sentences.

`@beaconsgg/eslint-config` ships two checks, and the gate runs both:

- `pnpm run check:copy` runs `beacon-check-copy --strict` over every Markdown file git tracks. The
  check covers the rules a script can see, and a warning fails the gate as well as an error.
- `pnpm run check:refs` runs `beacon-check-internal-refs --strict --allow org-names` over every file
  git tracks. The check fails on what a public reader can't open. That covers issue and pull request
  numbers, unpublished docs, plan wording and people's names. The names of the organization and
  its registry are listed but allowed until the repository moves to its public organization.

Check any other text by hand, for example the copy in a component:

```bash
pnpm exec beacon-check-copy --strict <changed-file>
```

Replace `<changed-file>` with a path or a glob. Pass as many as you need.

## Write a console plugin

The console names no game. A game's operator screens live in the game's own repository as a plugin
package named `@<game>/beacon-admin-plugin`, built against `@beaconsgg/admin-plugin`. A console
deployment chooses the plugins it carries when it builds.

- The [plugin contract's README](packages/admin/plugin/README.md) shows a plugin and the host that
  the console hands its screens.
- The console's [Game plugins](apps/admin/README.md#game-plugins) section shows how a deployment
  adds plugins and why the package name matters.

A change to the contract itself starts in `packages/admin/plugin`. The contract's public API is
listed in `packages/admin/plugin/public-api.txt`, and a removed or renamed name there is a breaking
change for every plugin.
