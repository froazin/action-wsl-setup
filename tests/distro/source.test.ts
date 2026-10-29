import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseImageSource, parseSha256 } from '../../src/distro/source.js'

const SHA = 'ab'.repeat(32)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseImageSource', () => {
  it('is undefined without an image', () => {
    expect(parseImageSource('', '')).toBeUndefined()
  })

  it('reads an https URL with its SHA-256', () => {
    expect(parseImageSource('https://example.com/my.wsl', `sha256:${SHA.toUpperCase()}`)).toEqual({
      kind: 'url',
      url: 'https://example.com/my.wsl',
      sha256: SHA,
    })
  })

  it('needs a SHA-256 for a URL', () => {
    expect(() => parseImageSource('https://example.com/my.wsl', '')).toThrow(/needs image-sha256/)
  })

  it('refuses plain http', () => {
    expect(() => parseImageSource('http://example.com/my.wsl', SHA)).toThrow(/must use https/)
  })

  it('reads an oci:// reference', () => {
    expect(parseImageSource('oci://ghcr.io/owner/wsl:fedora', '')).toEqual({
      kind: 'oci',
      reference: 'ghcr.io/owner/wsl:fedora',
    })
  })

  it.each(['oci://', 'oci://ghcr.io/Owner/wsl:1', 'oci://ghcr.io/o/wsl@sha256:abc'])(
    'fails on the malformed reference %s',
    (input) => {
      expect(() => parseImageSource(input, '')).toThrow(/image /)
    },
  )

  it("doesn't take a SHA-256 with an oci:// reference", () => {
    expect(() => parseImageSource('oci://ghcr.io/owner/wsl:fedora', SHA)).toThrow(/@sha256/)
  })

  it('reads a file in the workspace, with an optional SHA-256', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'workspace-'))
    writeFileSync(join(workspace, 'my.wsl'), '')
    vi.stubEnv('GITHUB_WORKSPACE', workspace)
    expect(parseImageSource('my.wsl', '')).toEqual({
      kind: 'file',
      path: join(workspace, 'my.wsl'),
      sha256: undefined,
    })
  })

  it('fails on a missing file', () => {
    vi.stubEnv('GITHUB_WORKSPACE', tmpdir())
    expect(() => parseImageSource('missing.wsl', '')).toThrow(/image is missing.wsl/)
  })

  it('fails on a SHA-256 without an image', () => {
    expect(() => parseImageSource('', SHA)).toThrow(/needs image/)
  })
})

describe('parseSha256', () => {
  it.each(['abc', 'g'.repeat(64), `0x${SHA}`])('rejects %j', (input) => {
    expect(() => parseSha256(input)).toThrow(/64 hexadecimal/)
  })
})
