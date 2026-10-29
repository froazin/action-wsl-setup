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
| `src/distro/` | Finding, downloading, caching and installing distribution images. Before you change it, read [docs/distributions.md](docs/distributions.md) |
| `src/cloudinit/` | Placing cloud-init seed files, waiting for cloud-init and judging the result. Before you change it, read [docs/cloud-init.md](docs/cloud-init.md) |
| `src/http.ts`, `src/hash.ts`, `src/files.ts` | Shared helpers: fetching with retries, a file's SHA-256, and resolving a path input against the workspace |
| `tests/` | Vitest unit tests, one `<module>.test.ts` per module in `src/` |
| `dist/` | The bundle runners execute, built by `npm run build`. Never edit it by hand |
| `docs/` | Design docs, one per part of the action |
| `.github/workflows/` | CI. `ci.yml` lints, tests and checks that `dist/` is up to date. `e2e.yml` runs the action on the hosted Windows images |
| `.github/scripts/`, `.github/fixtures/` | PowerShell scripts, and the cloud-init user-data and `.wslconfig` files the end-to-end jobs use |

## Conventions

- Rebuild `dist/` and commit it with every change to `src/`, `package.json` or `package-lock.json`. CI fails when it's out of date.
- The code is ESM. Import relative modules with a `.js` extension, such as `./main.js`.
- Keep the action generic: other people use it for their own purposes. It supports every hosted Windows image and self-hosted runners, so don't check for particular runner images. Rely on what WSL reports, and fail with its error.
- Run `wsl.exe` only through `wsl()` in [`src/wsl/exe.ts`](src/wsl/exe.ts), never by a bare `wsl` name.
- Update the README's inputs and outputs, and the design doc in `docs/`, in the same PR as the code they describe.
- Keep TypeScript on 6.0.x. ncc 0.45 compiles through TypeScript's JavaScript compiler API, which TypeScript 7 no longer has, so a TypeScript 7 build fails in ncc's ts-loader (observed).
- Install dependencies only through npm with this repository's `.npmrc`. Its `min-release-age=7` skips any version published in the last 7 days. Don't override it.
- Pin every action a workflow uses to a full commit SHA, with its version in a comment.
- Build, lint and test with the commands in [CONTRIBUTING.md](CONTRIBUTING.md).

## Ways of working

This project follows the user's shared ways of working (the `wow-*` skills). These are its specifics and overrides. Anything not listed here uses the shared defaults.

| Repository | Path | GitHub | Visibility | Default branch | Kind |
| --- | --- | --- | --- | --- | --- |
| Source | `.` | `froazin/action-wsl-setup` | Public | `main` | Code: PRs, squash-merged |

- **Commit scopes:** `wsl`, `distro`, `cloud-init`, `tooling`, `ci`, `deps`, `docs`, `claude`.
- **Feature flags:** none yet.
- **Releases:** none yet. The version is `0.0.1`, in alpha. How releases are tagged hasn't been decided.
- **CI:** `ci.yml` runs on every PR to `main`.
- **Build and test:** see [CONTRIBUTING.md](CONTRIBUTING.md).

### Overrides

- User docs (usage, inputs and outputs) live in `README.md`, not a wiki, because GitHub Marketplace shows an action's README.
