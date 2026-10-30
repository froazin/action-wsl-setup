import * as core from '@actions/core'
import { parseTimeout, provision } from './cloudinit/provision.js'
import {
  buildSeed,
  placeSeed,
  readInputFile,
  removeSavedSeed,
  type Seed,
} from './cloudinit/seed.js'
import { type DownloadedImage, downloadImage, useLocalImage } from './distro/download.js'
import {
  checkInstanceName,
  installImage,
  listInstances,
  parseWslVersion,
} from './distro/install.js'
import { type DistroImage, fetchManifest, fileName, findImage } from './distro/manifest.js'
import { resolveOciImage } from './distro/oci.js'
import { type ImageSource, parseImageSource } from './distro/source.js'
import { applyWslConfig, checkWslConfig, parseWslConfigRequest } from './wsl/config.js'
import { nativeArch, wslcPath } from './wsl/exe.js'
import { ensurePackage } from './wsl/package.js'
import { parsePackageRequest } from './wsl/releases.js'

/** Runs the action, failing the step with a message rather than throwing. */
export async function run(): Promise<void> {
  try {
    if (process.platform !== 'win32') {
      throw new Error(`WSL runs on Windows, but this runner is ${process.platform}.`)
    }
    // Check every input before changing anything on the runner.
    const request = parsePackageRequest(core.getInput('wsl-package-version'))
    const token = core.getInput('token')
    const distribution = core.getInput('distribution').trim()
    const source = parseImageSource(core.getInput('image'), core.getInput('image-sha256'))
    const instanceName = core.getInput('instance-name').trim() || distribution
    const wslVersion = parseWslVersion(core.getInput('wsl-version'))
    const useCache = core.getBooleanInput('cache')
    const allowDegraded = core.getBooleanInput('allow-degraded')
    const timeout = parseTimeout(core.getInput('cloud-init-timeout'))
    const wslconfig = checkWslConfig(
      parseWslConfigRequest(core.getInput('wslconfig')),
      core.getBooleanInput('wslconfig-overwrite'),
    )
    if (distribution && source) {
      throw new Error('Set distribution or image, not both.')
    }
    if (source && !instanceName) {
      throw new Error('image needs instance-name, the name to register the instance under.')
    }
    const installing = Boolean(distribution || source)
    if (installing) {
      checkInstanceName(instanceName)
    }
    const seed = readSeed(installing, instanceName, wslVersion)

    const version = await ensurePackage(request, token)
    const wslc = wslcPath()
    core.info(`Using WSL ${version.package} with kernel ${version.kernel}.`)
    core.setOutput('wsl-package-version', version.package)
    core.setOutput('kernel-version', version.kernel)
    core.setOutput('wslc-path', wslc ?? '')

    // These need WSL, but can still fail on the inputs, so they come before .wslconfig changes.
    const target = installing
      ? await findTarget(distribution, source, instanceName, useCache)
      : undefined
    // WSL reads .wslconfig when its virtual machine starts, so it goes in before any instance does.
    await applyWslConfig(wslconfig)

    if (!target) {
      return
    }
    const download = await target.fetch()
    // cloud-init reads the seed on the instance's first boot, so it must be in place first.
    const removeSeed = seed ? placeSeed(instanceName, seed) : undefined
    try {
      await core.group(`Install ${instanceName} as WSL ${wslVersion}`, () =>
        installImage(instanceName, download.path, wslVersion),
      )
      core.info(`Installed ${target.name} as ${instanceName}, a WSL ${wslVersion} instance.`)
      core.setOutput('instance-name', instanceName)
      core.setOutput('cache-hit', String(download.cacheHit))
      if (seed) {
        const status = await provision(instanceName, timeout, allowDegraded)
        core.info(`cloud-init provisioned ${instanceName} (${status}).`)
        core.setOutput('cloud-init-status', status)
      }
    } finally {
      removeSeed?.()
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

/** An image to install, and how to get it onto the runner. */
interface Target {
  name: string
  fetch: () => Promise<DownloadedImage>
}

/**
 * Checks the instance name is free and finds the image to install: a distribution from
 * Microsoft's manifest, or the image input's URL, OCI image or file.
 */
async function findTarget(
  distribution: string,
  source: ImageSource | undefined,
  instanceName: string,
  useCache: boolean,
): Promise<Target> {
  const existing = await listInstances()
  if (existing.some((i) => i.name.toLowerCase() === instanceName.toLowerCase())) {
    throw new Error(
      `The runner already has an instance named ${instanceName}. Set instance-name to another name.`,
    )
  }
  if (source?.kind === 'file') {
    return { name: source.path, fetch: () => useLocalImage(source.path, source.sha256) }
  }
  let image: DistroImage
  if (source?.kind === 'url') {
    const file = fileName(source.url, instanceName)
    image = { name: source.url, url: source.url, sha256: source.sha256, fileName: file }
  } else if (source?.kind === 'oci') {
    image = await resolveOciImage(source.reference, await nativeArch())
  } else {
    image = findImage(await fetchManifest(), distribution, await nativeArch())
  }
  return {
    name: image.name,
    fetch: () => core.group(`Download ${image.name}`, () => downloadImage(image, useCache)),
  }
}

/**
 * Runs after the job's steps, even when the job is cancelled or times out, and removes any seed
 * files run() didn't get to remove. They can hold secrets.
 */
export function post(): void {
  try {
    removeSavedSeed()
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}

/** Reads the cloud-init inputs into a seed, or undefined when there's no user-data. */
function readSeed(installing: boolean, instance: string, wslVersion: 1 | 2): Seed | undefined {
  const userData = core.getInput('cloud-init-user-data').trim()
  const metaData = core.getInput('cloud-init-meta-data').trim()
  if (!userData && !metaData) {
    return undefined
  }
  if (!userData) {
    throw new Error('cloud-init-meta-data needs cloud-init-user-data as well.')
  }
  if (!installing) {
    throw new Error('cloud-init-user-data needs a distribution or image to provision.')
  }
  if (wslVersion === 1) {
    throw new Error(
      "cloud-init needs WSL 2. WSL 1 instances don't run an init system, so cloud-init never starts. Set wsl-version to 2.",
    )
  }
  return buildSeed(
    instance,
    readInputFile(userData, 'cloud-init-user-data'),
    metaData ? readInputFile(metaData, 'cloud-init-meta-data') : undefined,
  )
}
