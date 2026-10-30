import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import { downloadTool } from '@actions/tool-cache'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadImage, useLocalImage } from '../../src/distro/download.js'
import type { DistroImage } from '../../src/distro/manifest.js'

vi.mock('@actions/core')
vi.mock('@actions/tool-cache')
vi.mock('@actions/cache')

const CONTENT = Buffer.from('a distribution image')
const SHA256 = createHash('sha256').update(CONTENT).digest('hex')
const IMAGE: DistroImage = {
  name: 'Ubuntu-26.04',
  url: 'https://example.com/ubuntu.wsl',
  sha256: SHA256,
  fileName: 'ubuntu.wsl',
}

/** Writes the image's content to a path, as a download or a cache restore would. */
function put(path: string, content: Buffer = CONTENT): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

let temp: string
let expectedPath: string

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'download-'))
  vi.stubEnv('RUNNER_TEMP', temp)
  expectedPath = join(temp, 'wsl-images', SHA256, 'ubuntu.wsl')
  vi.mocked(cache.isFeatureAvailable).mockReturnValue(true)
  vi.mocked(cache.restoreCache).mockResolvedValue(undefined)
  vi.mocked(cache.saveCache).mockResolvedValue(1)
  vi.mocked(downloadTool).mockImplementation(async (_url, dest) => {
    put(String(dest))
    return String(dest)
  })
})

describe('downloadImage', () => {
  it('downloads, checks and caches the image', async () => {
    await expect(downloadImage(IMAGE, true)).resolves.toEqual({
      path: expectedPath,
      cacheHit: false,
    })
    expect(downloadTool).toHaveBeenCalledWith(IMAGE.url, expectedPath, undefined)
    expect(cache.saveCache).toHaveBeenCalledWith([expectedPath], `wsl-image-${SHA256}`)
  })

  it('restores the image from the cache', async () => {
    vi.mocked(cache.restoreCache).mockImplementation(async () => {
      put(expectedPath)
      return `wsl-image-${SHA256}`
    })
    await expect(downloadImage(IMAGE, true)).resolves.toEqual({
      path: expectedPath,
      cacheHit: true,
    })
    expect(downloadTool).not.toHaveBeenCalled()
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('downloads again when the cached image is corrupt', async () => {
    vi.mocked(cache.restoreCache).mockImplementation(async () => {
      put(expectedPath, Buffer.from('corrupt'))
      return 'key'
    })
    await expect(downloadImage(IMAGE, true)).resolves.toMatchObject({ cacheHit: false })
    expect(downloadTool).toHaveBeenCalled()
  })

  it("doesn't touch the cache when it's off", async () => {
    await downloadImage(IMAGE, false)
    expect(cache.restoreCache).not.toHaveBeenCalled()
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it("doesn't touch the cache when the runner has none", async () => {
    vi.mocked(cache.isFeatureAvailable).mockReturnValue(false)
    await downloadImage(IMAGE, true)
    expect(cache.restoreCache).not.toHaveBeenCalled()
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('reuses an image an earlier step downloaded', async () => {
    put(expectedPath)
    await expect(downloadImage(IMAGE, true)).resolves.toEqual({
      path: expectedPath,
      cacheHit: false,
    })
    expect(downloadTool).not.toHaveBeenCalled()
    expect(cache.restoreCache).not.toHaveBeenCalled()
  })

  it("refuses and deletes an image that doesn't match its SHA-256", async () => {
    vi.mocked(downloadTool).mockImplementation(async (_url, dest) => {
      put(String(dest), Buffer.from('tampered'))
      return String(dest)
    })
    await expect(downloadImage(IMAGE, true)).rejects.toThrow(/has SHA-256 [0-9a-f]+, not /)
    expect(existsSync(expectedPath)).toBe(false)
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('carries on when the cache has nothing, as when the restore fails', async () => {
    vi.mocked(cache.restoreCache).mockResolvedValue(undefined)
    await expect(downloadImage(IMAGE, true)).resolves.toMatchObject({ cacheHit: false })
    expect(downloadTool).toHaveBeenCalled()
  })

  it("doesn't claim to have saved the image when the cache didn't save it", async () => {
    vi.mocked(cache.saveCache).mockResolvedValue(-1)
    await downloadImage(IMAGE, true)
    expect(core.info).not.toHaveBeenCalledWith(expect.stringMatching(/Saved .* to the cache/))
  })

  it('says when it saved the image', async () => {
    vi.mocked(cache.saveCache).mockResolvedValue(42)
    await downloadImage(IMAGE, true)
    expect(core.info).toHaveBeenCalledWith('Saved ubuntu.wsl to the cache.')
  })
})

describe('downloadImage with a registry token', () => {
  it('gets the token just before the download, and passes it as auth', async () => {
    const authorize = vi.fn(async () => 'Bearer fresh')
    await downloadImage({ ...IMAGE, authorize }, true)
    expect(downloadTool).toHaveBeenCalledWith(IMAGE.url, expectedPath, 'Bearer fresh')
    expect(authorize.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(cache.restoreCache).mock.invocationCallOrder[0] ?? Number.NaN,
    )
  })

  it("doesn't ask for a token when the cache has the image", async () => {
    const authorize = vi.fn(async () => 'Bearer fresh')
    vi.mocked(cache.restoreCache).mockImplementation(async (paths) => {
      put(paths[0] as string)
      return 'key'
    })
    await downloadImage({ ...IMAGE, authorize }, true)
    expect(authorize).not.toHaveBeenCalled()
  })
})

describe('downloadImage without a SHA-256', () => {
  const unchecked = { ...IMAGE, sha256: undefined }

  it('downloads into a new directory each time, warns and never caches', async () => {
    const first = await downloadImage(unchecked, true)
    const second = await downloadImage(unchecked, true)
    expect(first.path).not.toBe(second.path)
    expect(first.path).toMatch(/[\\/]unchecked[\\/]/)
    expect(existsSync(first.path)).toBe(true)
    expect(cache.restoreCache).not.toHaveBeenCalled()
    expect(cache.saveCache).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(`wasn't checked against a SHA-256`),
    )
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining(`Its SHA-256 is ${SHA256}`))
  })
})

describe('useLocalImage', () => {
  it('uses the file as it is without a SHA-256', async () => {
    await expect(useLocalImage('D:\\a\\my.wsl')).resolves.toEqual({
      path: 'D:\\a\\my.wsl',
      cacheHit: false,
    })
  })

  it('checks the file against a SHA-256', async () => {
    const path = join(temp, 'my.wsl')
    put(path)
    await expect(useLocalImage(path, SHA256)).resolves.toEqual({ path, cacheHit: false })
    await expect(useLocalImage(path, 'f'.repeat(64))).rejects.toThrow(/not f{64}/)
  })
})
