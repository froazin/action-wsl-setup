# action-wsl-setup

A GitHub Action that sets up WSL on GitHub hosted and self-hosted Windows runners. It's written in TypeScript and bundled into JavaScript with ncc.

## Contents

1. [Layout](#layout)
1. [Conventions](#conventions)
1. [Ways of working](#ways-of-working)

## Layout

| Path | Holds |
| --- | --- |
| `action.yml` | The action's metadata: name, inputs, outputs and the `node24` entry point |
| `src/` | The TypeScript source. `index.ts` is the entry point ncc bundles, for both the main and the post step, and `main.ts` holds `run()` and `post()` |
| `src/wsl/` | Running `wsl.exe`, finding and installing the WSL package, and `.wslconfig`. Before you change the package code, read [docs/wsl-package.md](docs/wsl-package.md). Before you change `config.ts`, read [docs/wslconfig.md](docs/wslconfig.md) |
| `src/distro/` | Finding, downloading, caching and installing distribution images, and images from a URL, an OCI registry or a file. Before you change it, read [docs/distributions.md](docs/distributions.md). Before you change `source.ts` or `oci.ts`, read [docs/images.md](docs/images.md) too |
| `src/cloudinit/` | Placing cloud-init seed files, waiting for cloud-init and judging the result. Before you change it, read [docs/cloud-init.md](docs/cloud-init.md) |
| `src/http.ts`, `src/hash.ts`, `src/files.ts` | Shared helpers: fetching with retries, a file's SHA-256, and resolving a path input against the workspace |
| `tests/` | Vitest unit tests, one `<module>.test.ts` per module in `src/` |
| `dist/` | The bundle runners execute, built by `npm run build`. Git ignores it on `main`. The release workflow builds it and commits it to the release branches |
| `docs/` | Design docs, one per part of the action |
| `.github/workflows/` | CI and releases. `ci.yml` and `pull-request.yml` run on pull requests. Before you change them, read [docs/ci.md](docs/ci.md). `release.yml`, `e2e.yml` and `wiki.yml` test `main`, release it and update the wiki. Before you change them, read [docs/releases.md](docs/releases.md) |
| `.github/scripts/`, `.github/fixtures/` | PowerShell scripts, and the cloud-init user-data and `.wslconfig` files the end-to-end jobs use |
| `.github/dependabot.yml` | The weekly dependency updates. See [Dependabot](docs/releases.md#dependabot) |
| `REVIEW.md` | Instructions for CI's Claude code review: what counts as Important, the Nit cap, what to skip, what to always check and the evidence a finding needs |

## Conventions

- Never commit `dist/` to `main`. Runners execute it from the release branches, `release/v0`, `release/v1` and so on, where the release workflow commits it. The `release/` prefix is only for those branches.
- The code is ESM. Import relative modules with a `.js` extension, such as `./main.js`.
- Keep the action generic: other people use it for their own purposes. It supports every hosted Windows image and self-hosted runners, so don't check for particular runner images. Rely on what WSL reports, and fail with its error.
- Run `wsl.exe` only through `wsl()` in [`src/wsl/exe.ts`](src/wsl/exe.ts), never by a bare `wsl` name.
- Update an input's or output's description in `action.yml`, the README's Inputs and Outputs tables and the design doc in `docs/` in the same PR as the code they describe. The wiki is updated from them after each release.
- Keep TypeScript on 6.0.x. ncc 0.45 compiles through TypeScript's JavaScript compiler API, which TypeScript 7 no longer has, so a TypeScript 7 build fails in ncc's ts-loader (observed).
- Install dependencies only through npm with this repository's `.npmrc`. Its `min-release-age=7` skips any version published in the last 7 days. Don't override it.
- Pin every action a workflow uses to a full commit SHA, with its version in a comment.
- Build, lint and test with the commands in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Squash-merge a pull request once `CI result` and `PR title and description` pass and every review thread is resolved.** Open a PR when it's ready for review, or a draft while you're still working on it. Write its title and description by [Pull requests](CONTRIBUTING.md#pull-requests), because they become the commit on `main`.
- Resolve a review thread only after you've fixed what it raises, or replied with why it isn't a problem.
- When you review a change locally, such as with `/code-review`, also follow `REVIEW.md` as it is on `main` (`git show main:REVIEW.md`), not a copy the change edits.

## Ways of working

This project follows the user's shared ways of working (the `wow-*` skills). These are its specifics and overrides. Anything not listed here uses the shared defaults.

| Repository | Path | GitHub | Visibility | Default branch | Kind |
| --- | --- | --- | --- | --- | --- |
| Source | `.` | `froazin/action-wsl-setup` | Public | `main` | Code: PRs, squash-merged |
| Wiki | `../action-wsl-setup.wiki/` | `froazin/action-wsl-setup.wiki` | Public | `master` | Wiki: direct commits, a push publishes. `wiki.yml` updates it after each release |

- **Commit scopes:** `wsl`, `distro`, `cloud-init`, `tooling`, `ci`, `deps`, `docs`, `claude`.
- **Feature flags:** none yet.
- **Releases:** `release.yml` runs every night. It tests `main` and releases when the built `dist/` or `action.yml` differ from the last release. Each release is a commit on the major version's branch, such as `release/v0`, with `dist/` added, tagged `vX.Y.Z`, with release notes Claude writes. The tags hold the version, in alpha until a maintainer releases `0.1.0` by hand. Don't tag a release, or push to a release branch, yourself. See [docs/releases.md](docs/releases.md).
- **CI:** `ci.yml` and `pull-request.yml` on every PR to `main`, and the lint, unit and end-to-end tests on `main` before each release. See [docs/ci.md](docs/ci.md).
- **Build and test:** see [CONTRIBUTING.md](CONTRIBUTING.md).

### Overrides

- User docs live in the wiki, which `wiki.yml` keeps in step with each release. `README.md` is the entry point, which GitHub Marketplace shows. It still holds the full usage docs until the first release's wiki is written from them. Then it's planned to shrink to a quick start with links to the wiki's pages.
