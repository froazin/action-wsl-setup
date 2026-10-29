# Contributing

How to report a problem, propose a change, and build and test the action.

## Reporting a problem

Open an issue. Include the runner image and version from the "Set up job" step of your workflow run, the action's inputs and the failing step's log.

## Proposing a change

1. Fork the repository and create a branch named `feature/<slug>`, `bugfix/<slug>` or `other/<slug>`.
1. Make one focused change, and rebase on `main` rather than merging it in.
1. Write commit messages and the pull request (PR) title as [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), such as `feat(distro): Add a source input`.
1. Open a PR to `main`. PRs are squash-merged, so the title and description become the commit on `main`.

## Prerequisites

- Node.js 24. `.nvmrc` pins it, so `nvm use` picks it up.
- npm 11.10.0 or later. `package.json` requires it, because older npm ignores the `min-release-age` setting in `.npmrc`.

## Building and testing

```bash
npm ci              # install the exact versions in package-lock.json
npm run check       # lint and check formatting with Biome
npm run fix         # apply Biome's safe fixes and formatting
npm run typecheck   # type check with tsc
npm test            # run the unit tests with Vitest
npm run build       # bundle src/ into dist/ with ncc
```

Runners execute `dist/`, not `src/`. Run `npm run build` and commit `dist/` with every change to the source or the dependencies.

`.npmrc` sets `min-release-age=7`, so npm won't install a version published in the last 7 days. Dependabot waits for the same cooldown.

## CI

Two workflows run on every PR to `main`:

- `.github/workflows/ci.yml` runs on Ubuntu. It lints, type checks, runs the unit tests, rebuilds `dist/` and fails if the result differs from the committed `dist/`.
- `.github/workflows/e2e.yml` runs the action from the PR's `dist/` on the `windows-2025`, `windows-2022` and `windows-11-arm` runners and checks what it did. It also checks that the action fails cleanly on Linux. The unit tests can't cover this, because they don't run on Windows.
