import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import * as core from '@actions/core'
import { exec } from '@actions/exec'
import { downloadTool } from '@actions/tool-cache'
import { packageDir, parseVersion, type WslVersion, wsl } from './exe.js'
import { findRelease, isRelease, type PackageRequest, type WslRelease } from './releases.js'

/** Reads the installed WSL package's version, or undefined when no package is installed. */
export async function installedVersion(): Promise<WslVersion | undefined> {
  if (!existsSync(join(packageDir(), 'wsl.exe'))) {
    return undefined
  }
  // Straight after an install, wsl.exe can still be finishing the upgrade, so retry briefly.
  for (let attempt = 1; ; attempt++) {
    const result = await wsl(['--version'])
    const version = result.exitCode === 0 ? parseVersion(result.stdout) : undefined
    if (version || attempt === 10) {
      return version
    }
    await sleep(3000)
  }
}

/**
 * Makes sure the WSL package the request asks for is installed, installing a release from
 * GitHub when it isn't, and returns the version that ends up installed.
 */
export async function ensurePackage(request: PackageRequest, token: string): Promise<WslVersion> {
  const installed = await installedVersion()
  if (installed) {
    core.info(`The runner has WSL ${installed.package}.`)
  } else {
    core.info("The runner doesn't have a WSL package installed.")
  }
  if (installed && request.kind === 'runner') {
    return installed
  }

  const release = await findRelease(
    request.kind === 'exact' ? request : { kind: 'latest' },
    process.arch,
    token,
  )
  if (installed && isRelease(installed.package, release.tag)) {
    core.info(`WSL ${installed.package} is already release ${release.tag}.`)
    return installed
  }

  await core.group(`Install WSL ${release.tag}`, () => install(release))
  const version = await installedVersion()
  if (!version) {
    throw new Error(`WSL ${release.tag} installed, but wsl.exe --version still fails.`)
  }
  if (!isRelease(version.package, release.tag)) {
    throw new Error(`Installed WSL ${release.tag}, but wsl.exe reports ${version.package}.`)
  }
  return version
}

async function install(release: WslRelease): Promise<void> {
  const temp = process.env.RUNNER_TEMP ?? process.env.TEMP ?? '.'
  core.info(`Downloading ${release.msiUrl}`)
  const msi = await downloadTool(release.msiUrl, join(temp, release.msiName))
  if (release.sha256) {
    const actual = await sha256(msi)
    if (actual !== release.sha256) {
      throw new Error(
        `${release.msiName} has SHA-256 ${actual}, but GitHub lists ${release.sha256}.`,
      )
    }
    core.info(`${release.msiName} matches its SHA-256 on GitHub.`)
  } else {
    core.warning(`GitHub lists no SHA-256 for ${release.msiName}, so it isn't verified.`)
  }

  const log = join(temp, `${release.msiName}.log`)
  const exitCode = await exec('msiexec.exe', ['/i', msi, '/qn', '/norestart', '/l*v', log], {
    ignoreReturnCode: true,
  })
  if (exitCode === 0) {
    return
  }
  if (existsSync(log)) {
    // msiexec writes its verbose log as UTF-16LE.
    const lines = readFileSync(log, 'utf16le').split(/\r?\n/)
    core.info(lines.slice(-40).join('\n'))
  }
  if (exitCode === 3010 || exitCode === 1641) {
    throw new Error(
      `WSL ${release.tag} needs Windows to restart (msiexec exit code ${exitCode}), which can't happen during a job.`,
    )
  }
  throw new Error(`msiexec failed to install WSL ${release.tag} with exit code ${exitCode}.`)
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}
