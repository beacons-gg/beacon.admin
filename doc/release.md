# Release the console

This page is for the maintainers. Running the console needs none of it: pull the released image as
the [README](../README.md#deploying-the-console) describes.

One run of the Release workflow ships both halves: the plugin contract to npm and the console's
image to GitHub Container Registry as `ghcr.io/beacons-gg/beacon-admin:<version>` and `latest`. CI
builds the image on every pull request without pushing it. The release pushes the image before
writing the tag and the GitHub Release, so an image exists for every listed version.

## Releasing the plugin contract

Merging to `main` validates and ships nothing. A release is one run of
[`.github/workflows/release.yml`](../.github/workflows/release.yml) on `main` with a version:

```
gh workflow run release.yml -f version=1.0.1
```

The run sets that version on `@beaconsgg/admin-plugin` in its own checkout and runs the whole gate.
The run then builds and publishes the package if the registry lacks that version and points
`latest` at the version. Last the run tags `v<version>` and creates the GitHub Release on the tag,
with notes generated from the PRs merged since the previous release. The run commits nothing, so
the manifest on `main` names `0.0.0`. The tags and the GitHub Releases record what was released, and
a new version has to be above the highest tag. A run that did not finish is run again with the same
version. The same workflow releases
Beacon's packages in [beacon.core](https://github.com/beacons-gg/beacon.core).

The contract has a version of its own, with the rules in
[beacon.core's `doc/core-compatibility.md` §8](https://github.com/beacons-gg/beacon.core/blob/main/doc/core-compatibility.md).
From `1.0.0` the version follows semantic versioning. A major release removes or renames a name in
`public-api.txt`, adds a required member to `GamePlugin` or moves the three core peers under the
contract's types to a new major. A new member of `AdminHost`, a new optional member of `GamePlugin`
and a new optional component prop are minor releases. A fix is a patch. A deprecated name keeps
working for at least one minor release and goes in a major at the earliest. A major comes first as
candidates (`2.0.0-rc.1`) under the `next` dist-tag.

[`CHANGELOG.md`](../CHANGELOG.md) says what a plugin has to change. The changelog has an entry for each
major and each deprecation, and a major's entry comes with its first candidate.

The console itself (`@beaconsgg/admin`) is private and never published.
