import { createHash } from 'node:crypto'
import { get } from '../http.js'
import type { DistroImage } from './manifest.js'

/** An image reference, split into the parts the registry API needs. */
export interface OciReference {
  /** The registry's host, such as `ghcr.io`. */
  registry: string
  repository: string
  /** The tag or `sha256:` digest to fetch the manifest by. */
  reference: string
  /** The digest the reference pins, which the manifest must match. */
  digest?: string
}

/** A repository name, by the OCI distribution spec's grammar. */
const COMPONENT = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*'
const REPOSITORY = new RegExp(`^${COMPONENT}(?:/${COMPONENT})*$`)

const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
]

interface Descriptor {
  mediaType?: string
  digest: string
  size?: number
  annotations?: Record<string, string>
  platform?: { architecture?: string; os?: string }
}

interface OciManifest {
  mediaType?: string
  manifests?: Descriptor[]
  layers?: Descriptor[]
}

/**
 * Splits a reference such as `ghcr.io/owner/image:tag` or `ghcr.io/owner/image@sha256:...`. A
 * reference without a registry, such as `alpine:3.22`, is on Docker Hub, as it is for docker pull.
 */
export function parseOciReference(input: string): OciReference {
  let rest = input.trim()
  let digest: string | undefined
  const at = rest.indexOf('@')
  if (at !== -1) {
    digest = rest.slice(at + 1).toLowerCase()
    rest = rest.slice(0, at)
    if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
      throw new Error(`image ${input} must pin a sha256: digest after @.`)
    }
  }
  const slash = rest.indexOf('/')
  const first = slash === -1 ? '' : rest.slice(0, slash)
  const hasRegistry = first.includes('.') || first.includes(':') || first === 'localhost'
  // docker pull treats the legacy host as Docker Hub too.
  let registry = !hasRegistry || first === 'index.docker.io' ? 'docker.io' : first
  let path = hasRegistry ? rest.slice(slash + 1) : rest
  const colon = path.lastIndexOf(':')
  const tag = colon === -1 ? undefined : path.slice(colon + 1)
  path = colon === -1 ? path : path.slice(0, colon)
  const validTag = tag === undefined || /^\w[\w.-]{0,127}$/.test(tag)
  if (!validTag || !REPOSITORY.test(path)) {
    throw new Error(`image ${input} isn't an OCI reference such as oci://ghcr.io/owner/image:tag.`)
  }
  if (registry === 'docker.io') {
    registry = 'registry-1.docker.io'
    path = path.includes('/') ? path : `library/${path}`
  }
  return { registry, repository: path, reference: digest ?? tag ?? 'latest', digest }
}

/** The OCI name for a Windows architecture from nativeArch. */
export function ociArch(arch: string): string {
  return arch === 'x64' ? 'amd64' : arch
}

/**
 * Finds the distribution image an OCI reference points at, for an architecture. An image index
 * picks the manifest for the architecture. The manifest's layer is the image: its only layer, or
 * the one whose title ends in `.wsl`, `.tar` or `.tar.gz`. The registry's digest becomes the
 * SHA-256 the download is checked against.
 */
export async function resolveOciImage(input: string, arch: string): Promise<DistroImage> {
  const ref = parseOciReference(input)
  const registry = new Registry(ref)
  let manifest = await registry.manifest(ref.reference, ref.digest)
  if (manifest.manifests) {
    const platform = ociArch(arch)
    const match = manifest.manifests.find(
      (m) => m.platform?.architecture === platform && (m.platform.os ?? 'linux') === 'linux',
    )
    if (!match) {
      const has = manifest.manifests.map((m) => m.platform?.architecture ?? 'unknown').join(', ')
      throw new Error(`image ${input} has no linux/${platform} image. It has: ${has}.`)
    }
    manifest = await registry.manifest(match.digest, match.digest)
  }
  const layer = pickLayer(manifest.layers ?? [], input)
  const sha256 = layer.digest.replace(/^sha256:/, '')
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`image ${input}'s layer has a digest the action can't check: ${layer.digest}.`)
  }
  return {
    name: input,
    url: `https://${ref.registry}/v2/${ref.repository}/blobs/${layer.digest}`,
    sha256,
    fileName: layerFileName(layer, ref.repository),
    authorize: () => registry.authorization(),
  }
}

/** Picks the layer that holds the image. */
export function pickLayer(layers: Descriptor[], input: string): Descriptor {
  const titled = layers.filter((l) =>
    /\.(wsl|tar|tar\.gz)$/i.test(l.annotations?.['org.opencontainers.image.title'] ?? ''),
  )
  const [only] = layers.length === 1 ? layers : titled.length === 1 ? titled : []
  if (!only) {
    throw new Error(
      `image ${input} has ${layers.length} layers, and the action can't tell which is the image. Push it with one layer, or with one whose title ends in .wsl.`,
    )
  }
  return only
}

/** The file name to save a layer as: its title, or the repository's last part with an extension. */
export function layerFileName(layer: Descriptor, repository: string): string {
  const title = layer.annotations?.['org.opencontainers.image.title'] ?? ''
  if (/^[\w.-]+$/.test(title) && !/^\.+$/.test(title)) {
    return title
  }
  const name = repository.split('/').pop() ?? 'image'
  // A plain tar layer stays .tar. A .wsl file is a gzipped tar, so a gzipped layer is one too.
  return /tar$/.test(layer.mediaType ?? '') ? `${name}.tar` : `${name}.wsl`
}

/** A registry's API for one repository, signing in anonymously when the registry asks. */
class Registry {
  private token?: string
  private challenge?: string

  constructor(private readonly ref: OciReference) {}

  headers(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {}
  }

  /**
   * The Authorization header for downloading a blob, with a new token when the registry wanted
   * one. Tokens can last as little as 5 minutes, such as Docker Hub's, so this runs just before
   * the download rather than reusing the manifest's token.
   */
  async authorization(): Promise<string | undefined> {
    if (!this.challenge) {
      return undefined
    }
    this.token = await this.signIn(this.challenge)
    return `Bearer ${this.token}`
  }

  /** Fetches a manifest, and checks it against a digest when one is given. */
  async manifest(reference: string, digest?: string): Promise<OciManifest> {
    const url = `https://${this.ref.registry}/v2/${this.ref.repository}/manifests/${reference}`
    const what = `the manifest for ${this.ref.repository}`
    const accept = { Accept: MANIFEST_TYPES.join(', ') }
    let response = await get(url, { ...accept, ...this.headers() }, what)
    if (response.status === 401 && !this.token) {
      this.challenge = response.headers.get('www-authenticate') ?? ''
      this.token = await this.signIn(this.challenge)
      response = await get(url, { ...accept, ...this.headers() }, what)
    }
    if (!response.ok) {
      throw new Error(`Couldn't fetch ${url}: it returned ${response.status}.${explain(response)}`)
    }
    const body = Buffer.from(await response.arrayBuffer())
    if (digest) {
      const actual = `sha256:${createHash('sha256').update(body).digest('hex')}`
      if (actual !== digest) {
        throw new Error(`The manifest for ${reference} has digest ${actual}, not ${digest}.`)
      }
    }
    try {
      return JSON.parse(body.toString('utf8')) as OciManifest
    } catch {
      const type = response.headers.get('content-type') ?? 'no content type'
      throw new Error(`${url} didn't return an OCI manifest, but ${type}.`)
    }
  }

  /** Gets an anonymous pull token from the realm a registry's Bearer challenge names. */
  private async signIn(challenge: string): Promise<string> {
    const params = Object.fromEntries(
      [...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    )
    if (!/^Bearer /i.test(challenge) || !params.realm?.startsWith('https://')) {
      throw new Error(
        `${this.ref.registry} asked for credentials the action doesn't support: ${challenge || 'none'}.`,
      )
    }
    const url = new URL(params.realm)
    if (params.service) url.searchParams.set('service', params.service)
    url.searchParams.set('scope', params.scope ?? `repository:${this.ref.repository}:pull`)
    const response = await get(url.toString(), {}, `a pull token from ${url.host}`)
    const body = (await response.json().catch(() => ({}))) as {
      token?: string
      access_token?: string
    }
    const token = body.token ?? body.access_token
    if (!response.ok || !token) {
      throw new Error(
        `${url.host} didn't give a pull token for ${this.ref.repository} (${response.status}). The action can only pull public images.`,
      )
    }
    return token
  }
}

/** Why a registry refused a manifest request, for the error. */
function explain(response: Response): string {
  switch (response.status) {
    case 401:
    case 403:
      return ' The action can only pull public images.'
    case 404:
      return ' Check the image name and tag.'
    case 429: {
      const after = response.headers.get('retry-after')
      return ` The registry is limiting pulls${after ? `, for ${after} seconds` : ''}.`
    }
    default:
      return ''
  }
}
