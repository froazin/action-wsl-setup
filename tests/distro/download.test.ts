import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import { downloadTool } from '@actions/tool-cache'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadImage } from '../../src/distro/download.js'
import type { DistroImage } from '../../src/distro/manifest.js'

vi.mock('@actions/core')
vi.mock('@actions/tool-cache')
vi.mock('@actions/cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@actions/cache')>()
  return {
    ReserveCacheError: actual.ReserveCacheError,
    isFeatureAvailable: vi.fn(),
    restoreCache: vi.fn(),
    saveCache: vi.fn(),
  }
})

const CONTENT = Buffer.from('a distribution image')
const IMAGE: DistroImage = {
  name: 'Ubuntu-26.04',
  url: 'https://example.com/ubuntu.wsl',
  sha256: createHash('sha256').update(CONTENT).digest('hex'),
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
  expectedPath = join(temp, 'wsl-images', IMAGE.sha256, 'ubuntu.wsl')
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
    expect(downloadTool).toHaveBeenCalledWith(IMAGE.url, expectedPath)
    expect(cache.saveCache).toHaveBeenCalledWith(
      [dirname(expectedPath)],
      `wsl-image-${IMAGE.sha256}`,
    )
  })

  it('restores the image from the cache', async () => {
    vi.mocked(cache.restoreCache).mockImplementation(async () => {
      put(expectedPath)
      return `wsl-image-${IMAGE.sha256}`
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
    await expect(downloadImage(IMAGE, true)).rejects.toThrow(/but the manifest lists/)
    expect(existsSync(expectedPath)).toBe(false)
    expect(cache.saveCache).not.toHaveBeenCalled()
  })

  it('carries on when the cache restore fails', async () => {
    vi.mocked(cache.restoreCache).mockRejectedValue(new Error('cache service down'))
    await expect(downloadImage(IMAGE, true)).resolves.toMatchObject({ cacheHit: false })
    expect(core.warning).toHaveBeenCalledWith(expect.stringMatching(/cache service down/))
  })

  it('only notes when another job is saving the same image', async () => {
    vi.mocked(cache.saveCache).mockRejectedValue(new cache.ReserveCacheError('already reserved'))
    await downloadImage(IMAGE, true)
    expect(core.warning).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(expect.stringMatching(/already reserved/))
  })

  it('warns when saving to the cache fails', async () => {
    vi.mocked(cache.saveCache).mockRejectedValue(new Error('upload failed'))
    await downloadImage(IMAGE, true)
    expect(core.warning).toHaveBeenCalledWith(expect.stringMatching(/upload failed/))
  })
})
