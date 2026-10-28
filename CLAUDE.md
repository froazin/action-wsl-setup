# action-wsl-setup

A GitHub Action that sets up WSL 2 on GitHub hosted Windows runners. It's written in TypeScript and bundled into JavaScript with ncc.

## Contents

1. [Layout](#layout)
1. [Conventions](#conventions)
1. [Ways of working](#ways-of-working)

## Layout

| Path | Holds |
| --- | --- |
| `action.yml` | The action's metadata: name, inputs, outputs and the `node24` entry point |
| `src/` | The TypeScript source. `index.ts` is the entry point ncc bundles, and `main.ts` holds `run()` |
| `tests/` | Vitest unit tests, one `<module>.test.ts` per module in `src/` |
| `dist/` | The bundle runners execute, built by `npm run build`. Never edit it by hand |
| `.github/workflows/` | CI. `ci.yml` lints, tests and checks that `dist/` is up to date |

## Conventions

- Rebuild `dist/` and commit it with every change to `src/`, `package.json` or `package-lock.json`. CI fails when it's out of date.
- The code is ESM. Import relative modules with a `.js` extension, such as `./main.js`.
- Support only WSL 2, and only on the `windows-2025` runner image. Don't add WSL 1, a fallback to it, or other runner images. Fail with a clear message instead.
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
