import { randomUUID } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import * as cache from '@actions/cache'
import * as core from '@actions/core'
import { downloadTool } from '@actions/tool-cache'
import { sha256 } from '../hash.js'
import type { DistroImage } from './manifest.js'

/** Where a downloaded image is, and whether it came from the Actions cache. */
export interface DownloadedImage {
  path: string
  cacheHit: boolean
}

/**
 * Downloads a distribution image and checks its SHA-256. With the cache on, it restores the
 * image from the Actions cache when it can, and saves it there after a download. The cache key
 * is the image's SHA-256, so a new image in the manifest is never served from an old entry.
 *
 * The cache holds the file itself, not its directory. @actions/cache versions an entry by its
 * paths, so an image that's renamed in the manifest gets a new entry rather than restoring a
 * file under the old name.
 *
 * @actions/cache logs its own failures and doesn't throw them, apart from invalid arguments, so
 * a cache that doesn't work only means a download.
 */
export async function downloadImage(
  image: DistroImage,
  useCache: boolean,
): Promise<DownloadedImage> {
  const expected = image.sha256
  if (!expected) {
    return downloadUnchecked(image)
  }
  const dir = join(imagesDir(), expected)
  const path = join(dir, image.fileName)
  const key = `wsl-image-${expected}`
  const caching = useCache && cache.isFeatureAvailable()

  // An earlier step in the job may have downloaded the same image.
  if (await matches(path, expected)) {
    core.info(`Using ${image.fileName}, which this job already downloaded.`)
    return { path, cacheHit: false }
  }
  rmSync(path, { force: true })

  if (caching) {
    if ((await cache.restoreCache([path], key)) && (await matches(path, expected))) {
      core.info(`Restored ${image.fileName} from the cache.`)
      return { path, cacheHit: true }
    }
    rmSync(path, { force: true })
  }

  core.info(`Downloading ${image.url}`)
  // downloadTool sets auth afresh on each try. A shared headers object would lose it after a
  // redirect to storage on another host, because @actions/http-client deletes it from the object.
  await downloadTool(image.url, path, await image.authorize?.())
  const actual = await sha256(path)
  if (actual !== expected) {
    rmSync(path, { force: true })
    throw new Error(`${image.fileName} has SHA-256 ${actual}, not ${expected}.`)
  }
  core.info(`${image.fileName} matches its SHA-256.`)

  // saveCache returns -1 when it didn't save, such as when another job is saving the same key,
  // and it has already logged why.
  if (caching && (await cache.saveCache([path], key)) !== -1) {
    core.info(`Saved ${image.fileName} to the cache.`)
  }
  return { path, cacheHit: false }
}

/**
 * Downloads an image there's no SHA-256 for, which only an image from a URL without image-sha256
 * can be. Nothing can check it, and the cache is keyed by SHA-256, so it's downloaded each time
 * into a new directory and never cached. It warns, and logs the SHA-256 to pin it with.
 */
async function downloadUnchecked(image: DistroImage): Promise<DownloadedImage> {
  const path = join(imagesDir(), 'unchecked', randomUUID(), image.fileName)
  core.info(`Downloading ${image.url}`)
  await downloadTool(image.url, path, await image.authorize?.())
  core.warning(
    `${image.fileName} wasn't checked against a SHA-256, because image-sha256 is empty, and it isn't cached. Its SHA-256 is ${await sha256(path)}: set image-sha256 to that to check it and cache it.`,
  )
  return { path, cacheHit: false }
}

function imagesDir(): string {
  return join(process.env.RUNNER_TEMP ?? process.env.TEMP ?? '.', 'wsl-images')
}

/**
 * Uses an image file that's already on the runner, such as one an earlier step built. With a
 * SHA-256, it checks the file first.
 */
export async function useLocalImage(path: string, expected?: string): Promise<DownloadedImage> {
  if (expected) {
    const actual = await sha256(path)
    if (actual !== expected) {
      throw new Error(`${path} has SHA-256 ${actual}, not ${expected}.`)
    }
    core.info(`${path} matches its SHA-256.`)
  }
  return { path, cacheHit: false }
}

async function matches(path: string, expected: string): Promise<boolean> {
  return existsSync(path) && (await sha256(path)) === expected
}
