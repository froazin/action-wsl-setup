import { get } from '../http.js'

/** A WSL package release on GitHub, with the MSI for one architecture. */
export interface WslRelease {
  tag: string
  msiName: string
  msiUrl: string
  /** The MSI's SHA-256 as lowercase hex, when GitHub reports one. */
  sha256?: string
}

interface GitHubAsset {
  name: string
  browser_download_url: string
  digest?: string | null
}

interface GitHubRelease {
  tag_name: string
  assets: GitHubAsset[]
}

const REPO = 'microsoft/WSL'

/** Which WSL package the action should end up with. */
export type PackageRequest =
  | { kind: 'runner' }
  | { kind: 'latest' }
  | { kind: 'exact'; tag: string }

/**
 * Parses the `wsl-package-version` input: empty keeps the runner's package, `latest` asks for the
 * newest release, and anything else must be a release tag such as `3.0.3`.
 */
export function parsePackageRequest(input: string): PackageRequest {
  const value = input.trim()
  if (value === '') {
    return { kind: 'runner' }
  }
  if (value.toLowerCase() === 'latest') {
    return { kind: 'latest' }
  }
  const match = /^v?(\d+\.\d+\.\d+)(?:\.0)?$/.exec(value)
  if (!match?.[1]) {
    throw new Error(
      `wsl-package-version must be empty, "latest" or a release such as "3.0.3", not "${value}".`,
    )
  }
  return { kind: 'exact', tag: match[1] }
}

/** True when an installed package version, such as `3.0.3.0`, is the release with this tag. */
export function isRelease(installed: string, tag: string): boolean {
  const have = installed.split('.').map(Number)
  const want = tag.split('.').map(Number)
  const length = Math.max(have.length, want.length)
  return Array.from({ length }, (_, i) => i).every((i) => (have[i] ?? 0) === (want[i] ?? 0))
}

/** The MSI architecture name for a Node.js architecture. */
export function msiArch(arch: string): string {
  if (arch === 'x64') return 'x64'
  if (arch === 'arm64') return 'arm64'
  throw new Error(`WSL packages are published for x64 and arm64, not ${arch}.`)
}

/** Picks the MSI for one architecture out of a GitHub release. */
export function toWslRelease(release: GitHubRelease, arch: string): WslRelease {
  const suffix = `.${msiArch(arch)}.msi`
  const asset = release.assets.find((a) => a.name.startsWith('wsl.') && a.name.endsWith(suffix))
  if (!asset) {
    throw new Error(`WSL release ${release.tag_name} has no ${suffix} installer.`)
  }
  const digest = asset.digest?.toLowerCase()
  return {
    tag: release.tag_name,
    msiName: asset.name,
    msiUrl: asset.browser_download_url,
    sha256: digest?.startsWith('sha256:') ? digest.slice('sha256:'.length) : undefined,
  }
}

/** Looks up the newest WSL release, or the one with a tag, through the GitHub API. */
export async function findRelease(
  request: { kind: 'latest' } | { kind: 'exact'; tag: string },
  arch: string,
  token: string,
): Promise<WslRelease> {
  const path = request.kind === 'latest' ? 'latest' : `tags/${encodeURIComponent(request.tag)}`
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'froazin/action-wsl-setup',
  }
  // The token is for github.com. On GitHub Enterprise Server, github.token isn't valid there.
  const onGitHubCom =
    (process.env.GITHUB_SERVER_URL ?? 'https://github.com') === 'https://github.com'
  if (token && onGitHubCom) {
    headers.Authorization = `Bearer ${token}`
  }
  const url = `https://api.github.com/repos/${REPO}/releases/${path}`
  const response = await get(url, headers, 'the WSL release')
  if (response.status === 404 && request.kind === 'exact') {
    throw new Error(
      `WSL release ${request.tag} doesn't exist. See https://github.com/${REPO}/releases.`,
    )
  }
  if (!response.ok) {
    throw new Error(`Couldn't look up the WSL release: ${url} returned ${response.status}.`)
  }
  return toWslRelease((await response.json()) as GitHubRelease, arch)
}
