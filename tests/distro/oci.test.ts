import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  layerFileName,
  parseOciReference,
  pickLayer,
  resolveOciImage,
} from '../../src/distro/oci.js'
import { get } from '../../src/http.js'

vi.mock('../../src/http.js')

const digest = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`
const LAYER = `sha256:${'c'.repeat(64)}`

describe('parseOciReference', () => {
  it.each([
    [
      'ghcr.io/froazin/wsl:fedora-44',
      { registry: 'ghcr.io', repository: 'froazin/wsl', reference: 'fedora-44' },
    ],
    [
      'ghcr.io/froazin/wsl',
      { registry: 'ghcr.io', repository: 'froazin/wsl', reference: 'latest' },
    ],
    ['localhost:5000/wsl:1', { registry: 'localhost:5000', repository: 'wsl', reference: '1' }],
    [
      'alpine:3.22',
      { registry: 'registry-1.docker.io', repository: 'library/alpine', reference: '3.22' },
    ],
    [
      'owner/image',
      { registry: 'registry-1.docker.io', repository: 'owner/image', reference: 'latest' },
    ],
    [
      'index.docker.io/alpine:3.22',
      { registry: 'registry-1.docker.io', repository: 'library/alpine', reference: '3.22' },
    ],
    [
      'ghcr.io/o/my--repo/foo__bar:1',
      { registry: 'ghcr.io', repository: 'o/my--repo/foo__bar', reference: '1' },
    ],
  ])('splits %s', (input, expected) => {
    expect(parseOciReference(input)).toEqual({ ...expected, digest: undefined })
  })

  it('fetches by the pinned digest', () => {
    const pinned = `sha256:${'a'.repeat(64)}`
    expect(parseOciReference(`ghcr.io/o/wsl:tag@${pinned}`)).toEqual({
      registry: 'ghcr.io',
      repository: 'o/wsl',
      reference: pinned,
      digest: pinned,
    })
  })

  it.each([
    'ghcr.io/Owner/wsl',
    'ghcr.io/o/wsl@sha256:abc',
    'ghcr.io/o/wsl:bad/tag',
    'ghcr.io/o/wsl:',
  ])('rejects %s', (input) => {
    expect(() => parseOciReference(input)).toThrow(/image/)
  })
})

describe('pickLayer', () => {
  const titled = (title: string) => ({
    digest: LAYER,
    annotations: { 'org.opencontainers.image.title': title },
  })

  it('takes the only layer', () => {
    expect(pickLayer([{ digest: LAYER }], 'x')).toEqual({ digest: LAYER })
  })

  it('takes the one layer titled as an image', () => {
    expect(pickLayer([titled('README.md'), titled('fedora.wsl')], 'x')).toEqual(
      titled('fedora.wsl'),
    )
  })

  it("fails when it can't tell which layer", () => {
    expect(() => pickLayer([{ digest: LAYER }, { digest: LAYER }], 'x')).toThrow(/2 layers/)
  })
})

describe('layerFileName', () => {
  it('uses a safe title', () => {
    expect(
      layerFileName(
        { digest: LAYER, annotations: { 'org.opencontainers.image.title': 'f.wsl' } },
        'o/wsl',
      ),
    ).toBe('f.wsl')
  })

  it('names a gzipped layer .wsl and a plain tar .tar', () => {
    const gzip = 'application/vnd.oci.image.layer.v1.tar+gzip'
    expect(layerFileName({ digest: LAYER, mediaType: gzip }, 'library/alpine')).toBe('alpine.wsl')
    const tar = 'application/vnd.oci.image.layer.v1.tar'
    expect(layerFileName({ digest: LAYER, mediaType: tar }, 'library/alpine')).toBe('alpine.tar')
  })

  it("ignores a title that isn't a plain file name", () => {
    const layer = { digest: LAYER, annotations: { 'org.opencontainers.image.title': '../x.wsl' } }
    expect(layerFileName(layer, 'o/wsl')).toBe('wsl.wsl')
  })
})

describe('resolveOciImage', () => {
  const manifest = JSON.stringify({
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    layers: [{ digest: LAYER, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' }],
  })
  const index = JSON.stringify({
    manifests: [
      { digest: digest('arm'), platform: { architecture: 'arm64', os: 'linux' } },
      { digest: digest(manifest), platform: { architecture: 'amd64', os: 'linux' } },
    ],
  })
  const challenge =
    'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:o/wsl:pull"'
  let responses: Record<string, () => Response>

  beforeEach(() => {
    responses = {
      'https://ghcr.io/v2/o/wsl/manifests/tag': () => new Response(index),
      [`https://ghcr.io/v2/o/wsl/manifests/${digest(manifest)}`]: () => new Response(manifest),
    }
    vi.mocked(get).mockImplementation(async (url) => {
      const respond = responses[url]
      return respond ? respond() : new Response('', { status: 404 })
    })
  })

  it('picks the manifest for the architecture and its layer', async () => {
    const image = await resolveOciImage('ghcr.io/o/wsl:tag', 'x64')
    expect(image).toMatchObject({
      name: 'ghcr.io/o/wsl:tag',
      url: `https://ghcr.io/v2/o/wsl/blobs/${LAYER}`,
      sha256: 'c'.repeat(64),
      fileName: 'wsl.wsl',
    })
    await expect(image.authorize?.()).resolves.toBeUndefined()
  })

  it('signs in anonymously when the registry asks, and again for the download', async () => {
    let tokens = 0
    responses['https://ghcr.io/v2/o/wsl/manifests/tag'] = () =>
      tokens > 0
        ? new Response(index)
        : new Response('', { status: 401, headers: { 'WWW-Authenticate': challenge } })
    responses['https://ghcr.io/token?service=ghcr.io&scope=repository%3Ao%2Fwsl%3Apull'] = () => {
      tokens++
      return Response.json({ token: `anonymous-${tokens}` })
    }
    const image = await resolveOciImage('ghcr.io/o/wsl:tag', 'x64')
    await expect(image.authorize?.()).resolves.toBe('Bearer anonymous-2')
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining('/manifests/sha256:'),
      expect.objectContaining({ Authorization: 'Bearer anonymous-1' }),
      expect.any(String),
    )
  })

  it('fails when the index has no image for the architecture', async () => {
    responses['https://ghcr.io/v2/o/wsl/manifests/tag'] = () =>
      new Response(
        JSON.stringify({ manifests: [{ digest: LAYER, platform: { architecture: 'amd64' } }] }),
      )
    await expect(resolveOciImage('ghcr.io/o/wsl:tag', 'arm64')).rejects.toThrow(
      /no linux\/arm64 image. It has: amd64/,
    )
  })

  it('fails when a pinned manifest has another digest', async () => {
    const pinned = `sha256:${'d'.repeat(64)}`
    responses[`https://ghcr.io/v2/o/wsl/manifests/${pinned}`] = () => new Response(manifest)
    await expect(resolveOciImage(`ghcr.io/o/wsl@${pinned}`, 'x64')).rejects.toThrow(
      `has digest ${digest(manifest)}, not ${pinned}`,
    )
  })

  it('fails on a private image', async () => {
    responses['https://ghcr.io/v2/o/wsl/manifests/tag'] = () =>
      new Response('', { status: 401, headers: { 'WWW-Authenticate': challenge } })
    responses['https://ghcr.io/token?service=ghcr.io&scope=repository%3Ao%2Fwsl%3Apull'] = () =>
      new Response('', { status: 403 })
    await expect(resolveOciImage('ghcr.io/o/wsl:tag', 'x64')).rejects.toThrow(
      /only pull public images/,
    )
  })

  it.each([
    [404, {}, /returned 404. Check the image name and tag/],
    [429, { 'Retry-After': '60' }, /returned 429. The registry is limiting pulls, for 60 seconds/],
  ])('explains a %d', async (status, headers, message) => {
    responses['https://ghcr.io/v2/o/wsl/manifests/tag'] = () =>
      new Response('', { status, headers })
    await expect(resolveOciImage('ghcr.io/o/wsl:tag', 'x64')).rejects.toThrow(message)
  })

  it("fails clearly on a response that isn't JSON", async () => {
    responses['https://ghcr.io/v2/o/wsl/manifests/tag'] = () =>
      new Response('<html>', { headers: { 'Content-Type': 'text/html' } })
    await expect(resolveOciImage('ghcr.io/o/wsl:tag', 'x64')).rejects.toThrow(
      /didn't return an OCI manifest, but text\/html/,
    )
  })
})
