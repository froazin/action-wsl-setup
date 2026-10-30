# Review instructions

What CI's Claude code review flags on pull requests (PRs) in this repository, at what severity and what it skips. Rules for all work are in `CLAUDE.md`, and a change that breaks one of them is a finding. This file adds only what's specific to reviews.

Judge the action as what ships: other people run it on their own runners. Judge the dev-time tooling, the tests and the CI workflows by whether they still check the action correctly, not by the standards of the action itself.

## What Important means here

Mark a finding Important only when the change would do one of these:

- Make the action do the wrong thing on a runner it supports, or fail where it should work. That covers every hosted Windows image and self-hosted runners. For example, a check for a particular runner image, or a `wsl.exe` failure that's swallowed rather than reported with WSL's error.
- Change what an input accepts, what it defaults to or what an output holds without updating its description in `action.yml` and the design doc in `docs/` in the same PR. The wiki is updated from them at the next release.
- Break the action's inputs, outputs or behaviour for existing users without a `!` in the PR's title. The release workflow works out the version from the commits on `main`.
- Leave cleanup undone: a post step that no longer removes what the main step wrote, such as cloud-init seed files, or a temporary file left behind on failure.
- Run `wsl.exe` other than through `wsl()` in `src/wsl/exe.ts`, or import a relative module without the `.js` extension.
- Trust a download it shouldn't: skip a SHA-256 or digest check the design docs say happens, follow a URL scheme other than the ones `docs/images.md` allows, or put an unchecked image in the Actions cache.
- Make CI skip a check that the change needs, such as a path added to `DOCS` in `.github/workflows/ci.yml` or `release.yml` that the build or tests read. Drop or narrow a check that the `checks` job or `e2e.yml` runs, or let the `CI result` job pass when a job it needs failed. Let the release workflow release a `dist/` the end-to-end tests didn't run. `docs/ci.md` and `docs/releases.md` describe how they should work.
- Widen what a Claude run in CI can do, such as its `permissions`, its `github_token`, its `--allowedTools` or its `--disallowedTools`, past what the "Security" sections of `docs/ci.md` and `docs/releases.md` allow, even when the change updates those docs too. Give `CLAUDE_CODE_OAUTH_TOKEN`, or a token that can write, to a step that runs the PR's or a dependency's code, such as `npm ci`.
- Weaken a supply-chain safeguard: the 7-day `min-release-age` in `.npmrc`, the 7-day Dependabot cooldown, `engine-strict` or pinning every action to a full commit SHA with its version in a comment. That includes pinning an action to a release less than 7 days old.
- Put a secret, token, credential, personal path or internal hostname into the repository. The repository is public.
- Make a design doc, the README, `CONTRIBUTING.md`, `CLAUDE.md` or this file say something about the code that's false after the change, so that someone following it would do the wrong thing.

Naming, structure, refactoring ideas, comments and doc wording are Nits at most.

## Pre-existing issues

Don't report an issue that was there before this PR, however serious. It's out of scope for the PR.

## Cap the Nits

Every comment must be resolved before the PR can merge, so report Nits sparingly: at most three per review, and only ones likely to mislead a maintainer or a Claude agent working from the docs. On a review after new commits, report Nits only on code those commits change. CI's code review posts none from the fourth review on a PR, as the "Code review" section of `docs/ci.md` says.

## Don't report

- Anything Biome, `tsc` or the unit tests report. CI runs them before the review.
- The contents of `package-lock.json`. It's generated.
- The PR's title and description. A separate check reviews them.
- A limit that a design doc's Limits section records, unless the change makes it worse.
- An issue that a resolved review thread on the PR already raises, whatever its replies say. Resolving a thread settles it.

## Always check

These are the rules that no tool, test or check enforces.

### The action

- A new or changed input is read and validated before the action changes anything on the runner, as the other inputs are.
- A new error message says what failed and what to do, and includes WSL's own error when there is one.
- A unit test added with new code would fail if the code were wrong, rather than only checking that a function was called.

### CI

- A new path that the build or the tests read isn't covered by `DOCS` in `.github/workflows/ci.yml` or `release.yml`, and the two lists still agree.
- A new job in `ci.yml` is in the `needs` list of the `CI result` job.
- Nothing commits `dist/` to `main`, and nothing but the release job writes to a release branch, such as `v0`, or makes a `vX.Y.Z` tag.
- The `merge` job in `ci.yml` still merges only PRs that Dependabot both opened and triggered, and only after `CI result` passed.
- A new job in `e2e.yml` needs the `build` job and tests its `dist` artifact, so what's released is what was tested.
- A new action that GitHub doesn't own needs a pattern on the repository's allow list, as the "Set up" section of `docs/ci.md` says. The list isn't in the repository, so report a new one as a Nit that reminds the maintainer to allow it.
- A change to this file's severities, its Nit cap or what it says about pre-existing issues also changes the code review's prompt in `.github/workflows/ci.yml`, and the other way round.
- A change to the PR rules in the "Pull requests" section of `CONTRIBUTING.md` still matches the commit-message prefix in `.github/dependabot.yml`, and the release workflow's prompt in `.github/workflows/release.yml`.
- A change to the version rules in the release workflow's prompt or its "Work out the version" step also changes `docs/releases.md`, and the other way round.

## Evidence

- Cite a `file:line` in this repository for every claim about behaviour. Don't infer behaviour from a name.
- A review doesn't run the action, WSL or the tests. Claim that something would fail on a runner only when the code or a design doc in the repository shows why.
