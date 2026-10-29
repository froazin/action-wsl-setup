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

### Installing your own image

Set `image` instead of `distribution` to install an image that isn't in Microsoft's list, and name the instance with `instance-name`:

```yaml
      - uses: froazin/action-wsl-setup@main
        with:
          image: oci://ghcr.io/owner/image:tag
          instance-name: mine
```

`image` takes one of these:

- An `https://` URL to a `.wsl` or `.tar.gz` file. Set `image-sha256` to the file's SHA-256 too, and the action fails if the download doesn't match it.
- An `oci://` reference to a public image in a registry such as `ghcr.io` or Docker Hub. The image must have one layer, or one layer whose title ends in `.wsl`, as `oras push` gives it. The action picks the runner's architecture from a multi-architecture image, and checks the download against the registry's digest. Add `@sha256:<digest>` to pin the image.
- A path to a file in the workspace, such as one an earlier step built. `image-sha256` is optional.

Downloaded images are cached by their SHA-256, as distributions are.

Call the action once for each instance you need. Give each one its own `instance-name` when they come from the same distribution.

### Provisioning with cloud-init

Give the action cloud-init user-data, and it provisions the instance on its first boot:

```yaml
      - uses: froazin/action-wsl-setup@main
        with:
          distribution: Ubuntu-26.04
          cloud-init-user-data: ci/Ubuntu-26.04.user-data
```

The action puts the user-data, and meta-data if you give it, in `%USERPROFILE%\.cloud-init` before the instance first starts. It then waits for cloud-init, shows cloud-init's log and fails the step if cloud-init failed. Afterwards it restarts the instance, so changes cloud-init made to `/etc/wsl.conf`, such as the default user, take effect, and checks systemd started cleanly. It removes the seed files it wrote, and its post step removes them if the job is cancelled or times out first.

cloud-init needs WSL 2 and an image that includes it, such as `Ubuntu-26.04`'s. If the instance has no cloud-init, the action fails rather than install it. If a seed file for the instance is already in `%USERPROFILE%\.cloud-init` with other content, the action fails rather than replace it.

### .wslconfig

On GitHub-hosted runners, the action writes a `.wslconfig` to the user's profile before any instance starts:

```ini
[wsl2]
guiApplications=false

[general]
instanceIdleTimeout=-1
```

Jobs run without a desktop, so WSLg has nothing to show. `instanceIdleTimeout=-1` keeps an idle instance running between steps, so its services don't start again for each step. If the runner already has a `.wslconfig`, the action keeps it. On a self-hosted runner, the action leaves `.wslconfig` alone, because the file would outlive the job.

Set `wslconfig` to the path of your own `.wslconfig` to use it instead, on any runner. If a different `.wslconfig` is already there, the action fails rather than replace it, unless you set `wslconfig-overwrite: true`. Set `wslconfig: none` to leave `.wslconfig` alone.

When the action writes a `.wslconfig`, it runs `wsl --shutdown` so WSL reads it, and warns if that stopped running instances. It doesn't restore the old file afterwards.

> [!IMPORTANT]
> A job that uses WSL can occasionally freeze the runner, and then step timeouts don't fire. Set `timeout-minutes` on the job.

### Inputs

| Input | Default | Description |
| --- | --- | --- |
| `wsl-package-version` | Empty | The WSL package to use. Empty uses the runner's package, or installs the newest release when there's none. `latest` installs the newest release. A release such as `3.0.3` installs exactly that one, upgrading or downgrading the runner's package |
| `token` | `${{ github.token }}` | A token for looking up WSL releases through the GitHub API, which avoids its unauthenticated rate limit |
| `distribution` | Empty | The distribution to install, by its name in `wsl --list --online`, such as `Ubuntu-26.04` or `FedoraLinux-44`. Distributions published only as Microsoft Store packages, such as `OracleLinux_9_5`, aren't supported. Empty sets up WSL without installing one |
| `image` | Empty | An image to install instead of `distribution`: an `https://` URL, an `oci://` reference to a public image, or a path in the workspace. See [Installing your own image](#installing-your-own-image) |
| `image-sha256` | Empty | The SHA-256 the image must match. Needed with a URL, optional with a file, and not used with `oci://`, which takes `@sha256:<digest>` instead |
| `instance-name` | The distribution's name | The name to register the instance under. Needed with `image`. The job fails if an instance already has that name |
| `wsl-version` | `2` | The instance's WSL version, `1` or `2`. The action never falls back from 2 to 1 |
| `cache` | `true` | Keep downloaded distribution images in the Actions cache |
| `cloud-init-user-data` | Empty | Path to cloud-init user-data for the instance's first boot, relative to the workspace |
| `cloud-init-meta-data` | Empty | Path to cloud-init meta-data. Without it, the action writes meta-data with `instance-id` set to the instance's name |
| `cloud-init-timeout` | `15` | Minutes to wait for cloud-init before failing, above 0 and up to 35791 |
| `allow-degraded` | `false` | Accept cloud-init finishing with recoverable errors, such as a deprecated key, or systemd starting with failed units, with a warning instead of failing |
| `wslconfig` | `default` | `default` writes the action's `.wslconfig` on GitHub-hosted runners only, and keeps an existing one. `none` leaves `.wslconfig` alone. Anything else is a path to a `.wslconfig`, relative to the workspace |
| `wslconfig-overwrite` | `false` | Replace a `.wslconfig` that's already there with other content. It never makes `default` write on a self-hosted runner |

### Outputs

| Output | Description |
| --- | --- |
| `wsl-package-version` | The installed WSL package version, such as `3.0.3.0` |
| `kernel-version` | The WSL kernel version, such as `6.18.54.1-1` |
| `wslc-path` | The path to `wslc.exe`, WSL's container command-line tool, which comes with WSL 3.0.1 and later. Empty when the package doesn't have it |
| `instance-name` | The installed instance's name. Empty without a `distribution` or `image` |
| `cache-hit` | `true` when the image came from the Actions cache, otherwise `false` |
| `cloud-init-status` | `done`, or `degraded` when `allow-degraded` let a degraded run through. Empty without user-data |

## Development

The action is written in TypeScript and bundled into JavaScript with ncc. [CONTRIBUTING.md](CONTRIBUTING.md) covers building, testing and CI. The design docs explain how each part works:

- [WSL package](docs/wsl-package.md): finding, installing and pinning the WSL package
- [.wslconfig](docs/wslconfig.md): deciding whether to write `.wslconfig`, and applying it
- [Distributions](docs/distributions.md): downloading, caching and installing distribution images
- [Images](docs/images.md): installing an image from a URL, an OCI registry or a file
- [cloud-init](docs/cloud-init.md): seeding, waiting for and judging cloud-init

## Licence

[MIT](LICENSE)
