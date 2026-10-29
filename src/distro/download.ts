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
 */
export async function downloadImage(
  image: DistroImage,
  useCache: boolean,
): Promise<DownloadedImage> {
  const dir = join(process.env.RUNNER_TEMP ?? process.env.TEMP ?? '.', 'wsl-images', image.sha256)
  const path = join(dir, image.fileName)
  const key = `wsl-image-${image.sha256}`

  // An earlier step in the job may have downloaded the same image.
  if (await matches(path, image.sha256)) {
    core.info(`Using ${image.fileName}, which this job already downloaded.`)
    return { path, cacheHit: false }
  }
  rmSync(path, { force: true })

  if (useCache && cache.isFeatureAvailable()) {
    try {
      if ((await cache.restoreCache([dir], key)) && (await matches(path, image.sha256))) {
        core.info(`Restored ${image.fileName} from the cache.`)
        return { path, cacheHit: true }
      }
    } catch (error) {
      core.warning(`Couldn't restore ${image.fileName} from the cache: ${message(error)}`)
    }
    rmSync(path, { force: true })
  }

  core.info(`Downloading ${image.url}`)
  await downloadTool(image.url, path)
  const actual = await sha256(path)
  if (actual !== image.sha256) {
    rmSync(path, { force: true })
    throw new Error(
      `${image.fileName} has SHA-256 ${actual}, but the manifest lists ${image.sha256}.`,
    )
  }
  core.info(`${image.fileName} matches its SHA-256 in the manifest.`)

  if (useCache && cache.isFeatureAvailable()) {
    try {
      await cache.saveCache([dir], key)
      core.info(`Saved ${image.fileName} to the cache.`)
    } catch (error) {
      // Another job saving the same image at the same time isn't a problem.
      const log = error instanceof cache.ReserveCacheError ? core.info : core.warning
      log(`Didn't save ${image.fileName} to the cache: ${message(error)}`)
    }
  }
  return { path, cacheHit: false }
}

async function matches(path: string, expected: string): Promise<boolean> {
  return existsSync(path) && (await sha256(path)) === expected
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
