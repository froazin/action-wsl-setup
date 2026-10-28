# Set up WSL

A GitHub Action that sets up WSL 2 on GitHub hosted Windows runners.

> [!WARNING]
> The action is under development and has no release yet. It does nothing so far.

## Planned

The action will:

- set up WSL 2 on the `windows-2025` runner image
- install a distribution by name, such as `Ubuntu-26.04`, or from a URL or OCI image
- provision it with cloud-init user-data and meta-data, and wait for cloud-init to finish

It won't support WSL 1, the `windows-2022` image or the `windows-11-arm` image. WSL 2 needs nested virtualisation, which the `windows-11-arm` runners don't have.

## Development

The action is written in TypeScript and bundled into JavaScript with ncc. [CONTRIBUTING.md](CONTRIBUTING.md) covers building, testing and CI.

## Licence

[MIT](LICENSE)
