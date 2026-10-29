import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchManifest, fileName, findImage, MANIFEST_URL } from '../../src/distro/manifest.js'

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => undefined) }))

const SHA = '48d56724b5c8e60f24893e83e73bbb58c60b3ca22fba3da977075420acd54104'

const MANIFEST = {
  ModernDistributions: {
    Ubuntu: [
      {
        Name: 'Ubuntu-26.04',
        Amd64Url: {
          Url: 'https://releases.ubuntu.com/26.04.1/ubuntu-26.04.1-wsl-amd64.wsl',
          Sha256: SHA,
        },
        Arm64Url: {
          Url: 'https://cdimages.ubuntu.com/releases/26.04.1/release/ubuntu-26.04.1-wsl-arm64.wsl',
          Sha256: SHA,
        },
      },
    ],
    openSUSE: [
      {
        Name: 'openSUSE-Tumbleweed',
        Amd64Url: {
          Url: 'https://example.com/openSUSE-Tumbleweed.x86_64.wsl',
          Sha256: `0x${SHA.toUpperCase()}`,
        },
      },
    ],
  },
}

describe('findImage', () => {
  it('finds the x64 image by name', () => {
    expect(findImage(MANIFEST, 'Ubuntu-26.04', 'x64')).toEqual({
      name: 'Ubuntu-26.04',
      url: 'https://releases.ubuntu.com/26.04.1/ubuntu-26.04.1-wsl-amd64.wsl',
      sha256: SHA,
      fileName: 'ubuntu-26.04.1-wsl-amd64.wsl',
    })
  })

  it('finds the arm64 image', () => {
    expect(findImage(MANIFEST, 'Ubuntu-26.04', 'arm64').fileName).toBe(
      'ubuntu-26.04.1-wsl-arm64.wsl',
    )
  })

  it('matches the name without regard to case', () => {
    expect(findImage(MANIFEST, 'ubuntu-26.04', 'x64').name).toBe('Ubuntu-26.04')
  })

  it('normalises a hash with a 0x prefix in upper case', () => {
    expect(findImage(MANIFEST, 'openSUSE-Tumbleweed', 'x64').sha256).toBe(SHA)
  })

  it('lists the names it has when the name is unknown', () => {
    expect(() => findImage(MANIFEST, 'Gentoo', 'x64')).toThrow(
      'WSL has no distribution named Gentoo. It has: Ubuntu-26.04, openSUSE-Tumbleweed.',
    )
  })

  it('fails when the distribution has no image for the architecture', () => {
    expect(() => findImage(MANIFEST, 'openSUSE-Tumbleweed', 'arm64')).toThrow(/no arm64 image/)
  })

  it('fails on an invalid hash', () => {
    const bad = {
      ModernDistributions: {
        X: [{ Name: 'X', Amd64Url: { Url: 'https://example.com/x.wsl', Sha256: 'abc' } }],
      },
    }
    expect(() => findImage(bad, 'X', 'x64')).toThrow(/invalid SHA-256/)
  })
})

describe('fileName', () => {
  it('uses the last part of the URL', () => {
    expect(fileName('https://example.com/a/Fedora-WSL-Base-44-1.7.x86_64.wsl', 'X')).toBe(
      'Fedora-WSL-Base-44-1.7.x86_64.wsl',
    )
  })

  it.each([
    'https://example.com/a/..',
    'https://example.com/a%2F..%2Fb.wsl',
    'https://example.com/',
    'https://example.com/bad name.wsl',
  ])('falls back to the distribution name for %s', (url) => {
    expect(fileName(url, 'Ubuntu-26.04')).toBe('Ubuntu-26.04.wsl')
  })
})

describe('fetchManifest', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads the manifest', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify(MANIFEST), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetch)
    await expect(fetchManifest()).resolves.toEqual(MANIFEST)
    expect(fetch.mock.calls[0]?.[0]).toBe(MANIFEST_URL)
  })

  it('fails when the download fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () => new Response('', { status: 404 })),
    )
    await expect(fetchManifest()).rejects.toThrow(/returned 404/)
  })
})
