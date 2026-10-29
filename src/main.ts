import * as core from '@actions/core'
import { wslcPath } from './wsl/exe.js'
import { ensurePackage } from './wsl/package.js'
import { parsePackageRequest } from './wsl/releases.js'

/** Runs the action, failing the step with a message rather than throwing. */
export async function run(): Promise<void> {
  try {
    if (process.platform !== 'win32') {
      throw new Error(`WSL runs on Windows, but this runner is ${process.platform}.`)
    }
    const request = parsePackageRequest(core.getInput('wsl-package-version'))
    const token = core.getInput('token')

    const version = await ensurePackage(request, token)
    const wslc = wslcPath()
    core.info(`Using WSL ${version.package} with kernel ${version.kernel}.`)

    core.setOutput('wsl-package-version', version.package)
    core.setOutput('kernel-version', version.kernel)
    core.setOutput('wslc-path', wslc ?? '')
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
