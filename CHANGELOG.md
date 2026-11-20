# Changelog

The release notes on each GitHub Release list the pull requests in it. This file adds what a game's
console plugin has to do when the plugin contract (`@beaconsgg/admin-plugin`) changes. The file
has the migration for each major and each deprecation with its replacement. Any other release that
asks a plugin to act gets an entry too. The newest release comes first. The rules are in
[beacon.core's `doc/core-compatibility.md`](https://github.com/beacons-gg/beacon.core/blob/main/doc/core-compatibility.md),
section 8 for the contract and section 9 for this file.

## 1.0.0

Release 1.0.0 is the contract's first stable release, and the contract moves to core 1.0 with it.
From here the promises of section 8 hold:

- The contract's public API is every name in `public-api.txt`, the members of `AdminHost` the
  console hands a plugin and the component props `AdminUi` declares.
- A major release removes or renames a name, adds a required member to `GamePlugin` or moves the
  three core peers to a new major. A new member of `AdminHost`, a new optional member of
  `GamePlugin` and a new optional component prop are minor releases. A fix is a patch.
- A deprecated name keeps working for at least one minor release and goes in the next major at the
  earliest. This file names each deprecation and its replacement.
- A plugin built against contract `1.y` works in every console built on `1.y` or a later 1.x
  release. The console's core packages then have to be at the core minor the plugin was built
  against or later.

A test double of `AdminHost` in a plugin's own tests is the plugin's to update when a minor adds a
member.

### What changed since 0.4

- (break) The three core peers take `^1.0.0` (`@beaconsgg/client-sdk`, `@beaconsgg/identity` and
  `@beaconsgg/protocol-types`). Every 1.x release of core satisfies that range. Contract 0.4 took
  `^0.4.0`. The contract's types are written in those three packages, so a major of core is a major
  of the contract. Core 1.0.0 removes every form core 0.4.3 deprecated and makes a few breaks of its
  own: [core's changelog](https://github.com/beacons-gg/beacon.core/blob/main/CHANGELOG.md#100)
  lists them.
- (break) The package declares `"engines": { "node": ">=22" }`, as every core package does from
  1.0.0.
- The contract's names are those of 0.4.0. `GamePlugin`, `AdminHost` and `AdminUi` keep their
  members and props. A plugin's screens and its test double of `AdminHost` therefore compile as
  before.
- The `client` a plugin gets from `useAdminHost()` declares the error codes the console's own
  client declares in `beacon-understands`: `code:unknownPlace`, `code:unknownProposal` and
  `code:unknownRun`. A write naming a place, a proposal or a run that the server doesn't have then gets that
  code at 404 from a server that sends the codes. Any other server still answers `unknownRoute`.
  `describeError` words each of the three codes.
- The package is licensed Apache-2.0 and ships its `LICENSE` and `NOTICE`. Contract 0.4.0 was
  unlicensed.

### Migration

A plugin uses the client SDK and the protocol types as a game does. The rows under "A game" in core's
changelog therefore apply wherever a plugin makes the same call.

| Where                                         | Old                                                                   | New                                                                                                                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The contract's range                          | `@beaconsgg/admin-plugin` at `^0.4.0`, as a peer and in development   | `^1.0.0` in both places. Drop `^0.4.0` from a peer range: contract 0.4's types are written in core 0.4, and a 1.0 console hands a plugin a core 1.0 client                                     |
| The core packages                             | every `@beaconsgg/*` core package at `^0.4.x`                         | `^1.0.0`, all together with the contract                                                                                                                                                       |
| The build                                     | any Node                                                              | Node 22 or later                                                                                                                                                                               |
| (break) A media URL from the SDK's `mediaUrl` | a `try` around the call for a malformed address                       | a check for `null`, which now covers a malformed address                                                                                                                                       |
| Wallets in a plugin's tests                   | `createWallet(issued)`, `walletFromMnemonic(phrase, issued, expires)` | `createWallet({ issued })`, `walletFromMnemonic(phrase, { issued, expires })`                                                                                                                  |
| A write that names a place, proposal or run   | `unknownRoute` read as "the thing is gone"                            | the code that names what is missing (`unknownPlace`, `unknownProposal` or `unknownRun`) or the sentence from `describeError`. Keep `unknownRoute` for a server that doesn't send the new codes |
