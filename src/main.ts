import * as core from '@actions/core'
import { downloadImage } from './distro/download.js'
import {
  checkInstanceName,
  installImage,
  listInstances,
  parseWslVersion,
} from './distro/install.js'
import { fetchManifest, findImage } from './distro/manifest.js'
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
    const instanceName = core.getInput('instance-name').trim() || distribution
    const wslVersion = parseWslVersion(core.getInput('wsl-version'))
    const useCache = core.getBooleanInput('cache')
    if (distribution) {
      checkInstanceName(instanceName)
    }

    const version = await ensurePackage(request, token)
    const wslc = wslcPath()
    core.info(`Using WSL ${version.package} with kernel ${version.kernel}.`)
    core.setOutput('wsl-package-version', version.package)
    core.setOutput('kernel-version', version.kernel)
    core.setOutput('wslc-path', wslc ?? '')

    if (!distribution) {
      return
    }
    const existing = await listInstances()
    if (existing.some((i) => i.name.toLowerCase() === instanceName.toLowerCase())) {
      throw new Error(
        `The runner already has an instance named ${instanceName}. Set instance-name to another name.`,
      )
    }
    const image = findImage(await fetchManifest(), distribution, await nativeArch())
    const download = await core.group(`Download ${image.name}`, () =>
      downloadImage(image, useCache),
    )
    await core.group(`Install ${instanceName} as WSL ${wslVersion}`, () =>
      installImage(instanceName, download.path, wslVersion),
    )
    core.info(`Installed ${image.name} as ${instanceName}, a WSL ${wslVersion} instance.`)
    core.setOutput('instance-name', instanceName)
    core.setOutput('cache-hit', String(download.cacheHit))
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
