# Set up WSL

A GitHub Action that sets up WSL on GitHub hosted and self-hosted Windows runners.

> [!WARNING]
> The action is under development and has no release yet. So far it only installs the WSL package.

## Usage

```yaml
jobs:
  test:
    runs-on: windows-2025
    steps:
      - uses: froazin/action-wsl-setup@main
        id: wsl

      - run: wsl.exe --version
```

The action makes sure the WSL package is installed. The `windows-2025` image already has one, and the action uses it. On `windows-2022`, `windows-11-arm` and any runner without one, it installs the newest release from [microsoft/WSL](https://github.com/microsoft/WSL/releases), after checking the installer against its SHA-256 on GitHub. Set `wsl-package-version` to pin a release instead.

> [!IMPORTANT]
> A job that uses WSL can occasionally freeze the runner, and then step timeouts don't fire. Set `timeout-minutes` on the job.

### Inputs

| Input | Default | Description |
| --- | --- | --- |
| `wsl-package-version` | Empty | The WSL package to use. Empty uses the runner's package, or installs the newest release when there's none. `latest` installs the newest release. A release such as `3.0.3` installs exactly that one, upgrading or downgrading the runner's package |
| `token` | `${{ github.token }}` | A token for looking up WSL releases through the GitHub API, which avoids its unauthenticated rate limit |

### Outputs

| Output | Description |
| --- | --- |
| `wsl-package-version` | The installed WSL package version, such as `3.0.3.0` |
| `kernel-version` | The WSL kernel version, such as `6.18.54.1-1` |
| `wslc-path` | The path to `wslc.exe`, WSL's container command-line tool, which comes with WSL 3.0.1 and later. Empty when the package doesn't have it |

## Planned

The action will also:

- install a distribution by name, such as `Ubuntu-26.04`, or from a URL or OCI image, as a WSL 1 or WSL 2 instance
- provision it with cloud-init user-data and meta-data, and wait for cloud-init to finish

The `windows-11-arm` runners have no nested virtualisation, so they can only run WSL 1 instances.

## Development

The action is written in TypeScript and bundled into JavaScript with ncc. [CONTRIBUTING.md](CONTRIBUTING.md) covers building, testing and CI. The design docs explain how each part works:

- [WSL package](docs/wsl-package.md): finding, installing and pinning the WSL package

## Licence

[MIT](LICENSE)
