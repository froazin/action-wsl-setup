# Contributing

How the maintainers build, test and land changes to the action, and how a pull request (PR) must be titled and described.

## Outside contributions

The project doesn't accept issues or PRs from outside its collaborators. The action is MIT licensed, so you're welcome to fork it and change it however you like. See [LICENSE](LICENSE).

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

Runners execute `dist/`, not `src/`. Git ignores `dist/` on `main`: the release workflow builds it and commits it to the release branch, so don't commit it yourself.

`.npmrc` sets `min-release-age=7`, so npm won't install a version published in the last 7 days. Dependabot waits for the same cooldown.

## Pull requests

PRs are squash-merged, so the title becomes the commit header on `main` and the description becomes the commit body. The release notes and the next version are worked out from those commits, and CI checks both against these rules, except on Dependabot's PRs.

- **Title:** a [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) header, `type(scope)!: Description`, such as `feat(distro): Add a source input`.
  - The type is lowercase, such as `feat`, `fix`, `refactor`, `test`, `docs`, `ci` or `chore`.
  - The scope is lowercase and one of the commit scopes in [CLAUDE.md](CLAUDE.md#contributing).
  - The description is an instruction that starts with a capital letter, such as "Add", and doesn't end with a full stop.
  - Leave out the PR number. GitHub adds it when it merges.
- **Description:** the commit body, in British English. Say what changed and why.
  - Add no footers, such as `Co-Authored-By:` or `BREAKING CHANGE:`. GitHub adds the co-authors from the branch's commits.
  - Close an issue with a line such as `Closes #123`, but not as the last paragraph.
  - No line may be `---` on its own, or start with `--- `. Git reads it as the start of a patch.
- **Breaking change:** a `!` straight before the colon in the title. Start the description with what breaks, why, who's affected and what to do instead.
- **`[skip ci]`:** don't add it. CI wouldn't run, so there'd be no `CI result` to merge on.
- **Dependabot:** its titles come from the `chore(deps)` prefix in `.github/dependabot.yml`, and its descriptions are its own. CI doesn't check or reword them. Dependabot copies the capitalisation of its last commit on `main`, so rename its first PR to start `chore(deps): Bump` by hand, and later ones follow.

A maintainer reviews and squash-merges every PR once `CI result` and `PR title and description` pass, every review thread is resolved and it's up to date with `main`. GitHub then deletes its branch. Open a draft PR while you're still working on a change, and mark it ready for review when it's done.

## CI

Every PR to `main` runs the checks in [docs/ci.md](docs/ci.md): lint, type check, unit tests and the build, then a code review by Claude. A separate check reviews the title and description. Changes only to docs skip the tests.

The end-to-end tests run the action on the hosted Windows runners. They run on a PR after the lint and unit tests, when it could change what runners execute, and on `main` again before each release, as [docs/releases.md](docs/releases.md) describes. To test a branch without a PR, run them by hand:

```bash
gh workflow run e2e.yml --ref <branch>
```
