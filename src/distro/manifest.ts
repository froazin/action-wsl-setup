import { get } from '../http.js'

/** Microsoft's list of the distributions `wsl --install` offers. */
export const MANIFEST_URL =
  'https://raw.githubusercontent.com/microsoft/WSL/master/distributions/DistributionInfo.json'

interface ManifestImage {
  Url: string
  Sha256: string
}

interface ManifestEntry {
  Name: string
  Amd64Url?: ManifestImage
  Arm64Url?: ManifestImage
}

/** The parts of DistributionInfo.json the action reads. */
export interface Manifest {
  /** Distributions published as `.wsl` images, which the action can install. */
  ModernDistributions?: Record<string, ManifestEntry[]>
  /** Older distributions published as Microsoft Store packages, which it can't. */
  Distributions?: { Name: string }[]
}

/** A distribution image to download: a `.wsl` file and its SHA-256. */
export interface DistroImage {
  name: string
  url: string
  sha256: string
  fileName: string
  /** Headers the download needs, such as a registry's pull token. */
  headers?: Record<string, string>
}

/** Downloads Microsoft's distribution manifest. */
export async function fetchManifest(): Promise<Manifest> {
  const response = await get(MANIFEST_URL, {}, "Microsoft's list of WSL distributions")
  if (!response.ok) {
    throw new Error(`Couldn't download ${MANIFEST_URL}: it returned ${response.status}.`)
  }
  return (await response.json()) as Manifest
}

/**
 * Finds a distribution's image for an architecture in the manifest. Names match without regard
 * to case, as they do for `wsl --install`.
 */
export function findImage(manifest: Manifest, name: string, arch: string): DistroImage {
  const entries = Object.values(manifest.ModernDistributions ?? {}).flat()
  const entry = entries.find((e) => e.Name.toLowerCase() === name.toLowerCase())
  if (!entry) {
    const names = entries.map((e) => e.Name).join(', ')
    const legacy = manifest.Distributions?.find((d) => d.Name.toLowerCase() === name.toLowerCase())
    if (legacy) {
      throw new Error(
        `${legacy.Name} is only published as a Microsoft Store package, which this action can't install. It can install: ${names}.`,
      )
    }
    throw new Error(`WSL has no distribution named ${name}. It has: ${names}.`)
  }
  const image = arch === 'arm64' ? entry.Arm64Url : entry.Amd64Url
  if (!image) {
    throw new Error(`${entry.Name} has no ${arch} image.`)
  }
  // Some entries give the hash in upper case or with a 0x prefix.
  const sha256 = image.Sha256.toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(
      `${entry.Name}'s image has an invalid SHA-256 in the manifest: ${image.Sha256}.`,
    )
  }
  return { name: entry.Name, url: image.Url, sha256, fileName: fileName(image.Url, entry.Name) }
}

/** A safe file name for a download, from the last part of its URL. */
export function fileName(url: string, fallback: string): string {
  let last: string
  try {
    last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  } catch {
    return `${fallback}.wsl`
  }
  return /^[\w.-]+$/.test(last) && !/^\.+$/.test(last) ? last : `${fallback}.wsl`
}
