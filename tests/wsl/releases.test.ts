import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findRelease,
  isRelease,
  msiArch,
  parsePackageRequest,
  toWslRelease,
} from '../../src/wsl/releases.js'

const RELEASE = {
  tag_name: '3.0.3',
  assets: [
    {
      name: 'wsl.3.0.3.0.arm64.msi',
      browser_download_url: 'https://example.com/wsl.3.0.3.0.arm64.msi',
      digest: 'sha256:2937c7ce840bb35ec6e97f052189bdfff27f8c3463bfdd231df9a958212787a3',
    },
    {
      name: 'wsl.3.0.3.0.x64.msi',
      browser_download_url: 'https://example.com/wsl.3.0.3.0.x64.msi',
      digest: 'sha256:AE977286974255BD26BF925F00F40F5692C6B2084155CBC0563C09AEA091F211',
    },
    { name: 'Microsoft.WSL_3.0.3.0_x64_ARM64.msixbundle', browser_download_url: 'x', digest: null },
  ],
}

describe('parsePackageRequest', () => {
  it.each([
    ['', { kind: 'runner' }],
    ['  ', { kind: 'runner' }],
    ['latest', { kind: 'latest' }],
    ['Latest', { kind: 'latest' }],
    ['3.0.3', { kind: 'exact', tag: '3.0.3' }],
    ['3.0.3.0', { kind: 'exact', tag: '3.0.3' }],
    ['v2.7.14', { kind: 'exact', tag: '2.7.14' }],
  ])('parses %j', (input, expected) => {
    expect(parsePackageRequest(input)).toEqual(expected)
  })

  it.each(['3', '3.0', '3.0.3.1', 'newest', '3.0.3; rm -rf /'])('rejects %j', (input) => {
    expect(() => parsePackageRequest(input)).toThrow(/wsl-package-version/)
  })
})

describe('isRelease', () => {
  it.each([
    ['3.0.3.0', '3.0.3', true],
    ['3.0.3', '3.0.3', true],
    ['3.0.30.0', '3.0.3', false],
    ['3.0.3.1', '3.0.3', false],
    ['3.0', '3.0.3', false],
    ['2.7.14.0', '3.0.3', false],
  ])('%s is release %s: %s', (installed, tag, expected) => {
    expect(isRelease(installed, tag)).toBe(expected)
  })
})

describe('msiArch', () => {
  it('maps x64 and arm64', () => {
    expect(msiArch('x64')).toBe('x64')
    expect(msiArch('arm64')).toBe('arm64')
  })

  it('rejects other architectures', () => {
    expect(() => msiArch('ia32')).toThrow(/x64 and arm64/)
  })
})

describe('toWslRelease', () => {
  it('picks the MSI for the architecture and normalises its digest', () => {
    expect(toWslRelease(RELEASE, 'x64')).toEqual({
      tag: '3.0.3',
      msiName: 'wsl.3.0.3.0.x64.msi',
      msiUrl: 'https://example.com/wsl.3.0.3.0.x64.msi',
      sha256: 'ae977286974255bd26bf925f00f40f5692c6b2084155cbc0563c09aea091f211',
    })
    expect(toWslRelease(RELEASE, 'arm64').msiName).toBe('wsl.3.0.3.0.arm64.msi')
  })

  it('leaves the digest out when GitHub has none', () => {
    const release = { ...RELEASE, assets: RELEASE.assets.map((a) => ({ ...a, digest: null })) }
    expect(toWslRelease(release, 'x64').sha256).toBeUndefined()
  })

  it('fails when the release has no MSI for the architecture', () => {
    expect(() => toWslRelease({ tag_name: '1.0.0', assets: [] }, 'x64')).toThrow(/no \.x64\.msi/)
  })
})

describe('findRelease', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function stubFetch(status: number, body: unknown = RELEASE) {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify(body), { status }),
    )
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('asks for the latest release with the token', async () => {
    const fetch = stubFetch(200)
    vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com')
    await findRelease({ kind: 'latest' }, 'x64', 'secret')
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/microsoft/WSL/releases/latest',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
      }),
    )
  })

  it('asks for a release by tag', async () => {
    const fetch = stubFetch(200)
    await findRelease({ kind: 'exact', tag: '2.7.14' }, 'x64', '')
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/microsoft/WSL/releases/tags/2.7.14',
    )
  })

  it("doesn't send the token from GitHub Enterprise Server", async () => {
    const fetch = stubFetch(200)
    vi.stubEnv('GITHUB_SERVER_URL', 'https://ghes.example.com')
    await findRelease({ kind: 'latest' }, 'x64', 'secret')
    const init = fetch.mock.calls[0]?.[1] as { headers: Record<string, string> } | undefined
    expect(init?.headers.Authorization).toBeUndefined()
  })

  it('says when a tag does not exist', async () => {
    stubFetch(404, { message: 'Not Found' })
    await expect(findRelease({ kind: 'exact', tag: '9.9.9' }, 'x64', '')).rejects.toThrow(
      /WSL release 9\.9\.9 doesn't exist/,
    )
  })

  it('reports other API failures', async () => {
    stubFetch(403, { message: 'rate limited' })
    await expect(findRelease({ kind: 'latest' }, 'x64', '')).rejects.toThrow(/returned 403/)
  })
})
