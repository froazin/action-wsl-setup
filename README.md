# Set up WSL

A GitHub Action that sets up WSL on GitHub hosted and self-hosted Windows runners.

> [!WARNING]
> The action is under development and has no release yet.

## Usage

```yaml
jobs:
  test:
    runs-on: windows-2025
    steps:
      - uses: froazin/action-wsl-setup@main
        id: wsl
        with:
          distribution: Ubuntu-26.04

      - run: wsl.exe -d ${{ steps.wsl.outputs.instance-name }} -- uname -a
```

The action makes sure the WSL package is installed. The `windows-2025` image already has one, and the action uses it. On `windows-2022`, `windows-11-arm` and any runner without one, it installs the newest release from [microsoft/WSL](https://github.com/microsoft/WSL/releases), after checking the installer against its SHA-256 on GitHub. Set `wsl-package-version` to pin a release instead.

With `distribution`, it then installs that distribution as a new instance, without starting it. It downloads the image listed in Microsoft's [`DistributionInfo.json`](https://github.com/microsoft/WSL/blob/master/distributions/DistributionInfo.json), the same list `wsl --list --online` shows, checks it against the SHA-256 listed there and keeps it in the Actions cache for later runs.

Instances are WSL 2 unless you set `wsl-version: 1`. WSL 2 needs virtualisation, which the `windows-11-arm` runners don't have, so set `wsl-version: 1` there:

```yaml
    runs-on: windows-11-arm
    steps:
      - uses: froazin/action-wsl-setup@main
        with:
          distribution: Ubuntu-26.04
          wsl-version: 1
```

Call the action once for each instance you need. Give each one its own `instance-name` when they come from the same distribution.

> [!IMPORTANT]
> A job that uses WSL can occasionally freeze the runner, and then step timeouts don't fire. Set `timeout-minutes` on the job.

### Inputs

| Input | Default | Description |
| --- | --- | --- |
| `wsl-package-version` | Empty | The WSL package to use. Empty uses the runner's package, or installs the newest release when there's none. `latest` installs the newest release. A release such as `3.0.3` installs exactly that one, upgrading or downgrading the runner's package |
| `token` | `${{ github.token }}` | A token for looking up WSL releases through the GitHub API, which avoids its unauthenticated rate limit |
| `distribution` | Empty | The distribution to install, by its name in `wsl --list --online`, such as `Ubuntu-26.04` or `FedoraLinux-44`. Distributions published only as Microsoft Store packages, such as `OracleLinux_9_5`, aren't supported. Empty sets up WSL without installing one |
| `instance-name` | The distribution's name | The name to register the instance under. The job fails if an instance already has that name |
| `wsl-version` | `2` | The instance's WSL version, `1` or `2`. The action never falls back from 2 to 1 |
| `cache` | `true` | Keep downloaded distribution images in the Actions cache |

### Outputs

| Output | Description |
| --- | --- |
| `wsl-package-version` | The installed WSL package version, such as `3.0.3.0` |
| `kernel-version` | The WSL kernel version, such as `6.18.54.1-1` |
| `wslc-path` | The path to `wslc.exe`, WSL's container command-line tool, which comes with WSL 3.0.1 and later. Empty when the package doesn't have it |
| `instance-name` | The installed instance's name. Empty without a `distribution` |
| `cache-hit` | `true` when the distribution image came from the Actions cache, otherwise `false` |

## Planned

The action will also:

- install a distribution from a URL or OCI image
- provision it with cloud-init user-data and meta-data, and wait for cloud-init to finish

## Development

The action is written in TypeScript and bundled into JavaScript with ncc. [CONTRIBUTING.md](CONTRIBUTING.md) covers building, testing and CI. The design docs explain how each part works:

- [WSL package](docs/wsl-package.md): finding, installing and pinning the WSL package
- [Distributions](docs/distributions.md): downloading, caching and installing distribution images

## Licence

[MIT](LICENSE)
