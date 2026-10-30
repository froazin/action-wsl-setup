import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '@actions/core'
import { exec } from '@actions/exec'
import { downloadTool } from '@actions/tool-cache'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nativeArch, wsl } from '../../src/wsl/exe.js'
import { ensurePackage } from '../../src/wsl/package.js'
import { findRelease, type WslRelease } from '../../src/wsl/releases.js'

vi.mock('@actions/core')
vi.mock('@actions/exec')
vi.mock('@actions/tool-cache')
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => undefined) }))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: vi.fn(),
}))
vi.mock('../../src/wsl/exe.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/wsl/exe.js')>()),
  wsl: vi.fn(),
  nativeArch: vi.fn(),
  packageDir: () => 'C:\\Program Files\\WSL',
}))
vi.mock('../../src/wsl/releases.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/wsl/releases.js')>()),
  findRelease: vi.fn(),
}))

const MSI = Buffer.from('not really an msi')
const RELEASE: WslRelease = {
  tag: '3.0.3',
  msiName: 'wsl.3.0.3.0.x64.msi',
  msiUrl: 'https://example.com/wsl.3.0.3.0.x64.msi',
  sha256: createHash('sha256').update(MSI).digest('hex'),
}

/** What the fake runner has: the installed package version, if any. */
let installed: string | undefined
/** What the fake runner reports after msiexec succeeds. */
let afterInstall: string

/** Writes the fake MSI where downloadTool would have, and returns its path. */
function fakeMsi(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'msi-')), 'wsl.msi')
  writeFileSync(path, MSI)
  return path
}

function versionOutput(version: string): string {
  return `WSL version: ${version}\nKernel version: 6.18.54.1-1\n`
}

beforeEach(() => {
  installed = undefined
  afterInstall = '3.0.3.0'
  vi.mocked(core.group).mockImplementation(async (_name, fn) => fn())
  vi.mocked(existsSync).mockImplementation(
    (path) => String(path).endsWith('wsl.exe') && !!installed,
  )
  vi.mocked(wsl).mockImplementation(async () =>
    installed ? { exitCode: 0, stdout: versionOutput(installed) } : { exitCode: 1, stdout: '' },
  )
  vi.mocked(nativeArch).mockResolvedValue('x64')
  vi.mocked(findRelease).mockResolvedValue(RELEASE)
  vi.mocked(downloadTool).mockImplementation(async (_url, dest) => {
    expect(dest).toMatch(/wsl-[0-9a-f-]{36}[\\/]wsl\.3\.0\.3\.0\.x64\.msi$/)
    return fakeMsi()
  })
  vi.mocked(exec).mockImplementation(async () => {
    installed = afterInstall
    return 0
  })
})

describe('ensurePackage', () => {
  it("keeps the runner's package without looking anything up", async () => {
    installed = '3.0.3.0'
    await expect(ensurePackage({ kind: 'runner' }, '')).resolves.toEqual({
      package: '3.0.3.0',
      kernel: '6.18.54.1-1',
    })
    expect(findRelease).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
  })

  it('keeps a pinned release the runner already has without looking it up', async () => {
    installed = '3.0.3.0'
    await ensurePackage({ kind: 'exact', tag: '3.0.3' }, '')
    expect(findRelease).not.toHaveBeenCalled()
    expect(exec).not.toHaveBeenCalled()
  })

  it('keeps the package when it is already the newest release', async () => {
    installed = '3.0.3.0'
    await ensurePackage({ kind: 'latest' }, 'token')
    expect(findRelease).toHaveBeenCalledWith({ kind: 'latest' }, 'x64', 'token')
    expect(exec).not.toHaveBeenCalled()
  })

  it('installs the newest release on a runner without a package', async () => {
    vi.mocked(nativeArch).mockResolvedValue('arm64')
    const version = await ensurePackage({ kind: 'runner' }, 'token')
    expect(findRelease).toHaveBeenCalledWith({ kind: 'latest' }, 'arm64', 'token')
    expect(exec).toHaveBeenCalledWith(
      'msiexec.exe',
      expect.arrayContaining(['/i', '/qn', '/norestart']),
      expect.anything(),
    )
    expect(version.package).toBe('3.0.3.0')
  })

  it('downgrades to a pinned release', async () => {
    installed = '3.0.3.0'
    afterInstall = '2.7.14.0'
    vi.mocked(findRelease).mockResolvedValue({ ...RELEASE, tag: '2.7.14' })
    const version = await ensurePackage({ kind: 'exact', tag: '2.7.14' }, '')
    expect(findRelease).toHaveBeenCalledWith({ kind: 'exact', tag: '2.7.14' }, 'x64', '')
    expect(version.package).toBe('2.7.14.0')
  })

  it('downloads each install into its own directory', async () => {
    const dests: string[] = []
    vi.mocked(downloadTool).mockImplementation(async (_url, dest) => {
      dests.push(String(dest))
      return fakeMsi()
    })
    await ensurePackage({ kind: 'latest' }, '')
    installed = '2.7.14.0'
    await ensurePackage({ kind: 'latest' }, '')
    expect(dests).toHaveLength(2)
    expect(dests[0]).not.toBe(dests[1])
  })

  it("refuses an MSI that doesn't match its SHA-256", async () => {
    vi.mocked(findRelease).mockResolvedValue({ ...RELEASE, sha256: '0'.repeat(64) })
    await expect(ensurePackage({ kind: 'latest' }, '')).rejects.toThrow(/has SHA-256 .* but GitHub/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('installs an MSI GitHub lists no SHA-256 for, with a warning', async () => {
    vi.mocked(findRelease).mockResolvedValue({ ...RELEASE, sha256: undefined })
    await ensurePackage({ kind: 'latest' }, '')
    expect(core.warning).toHaveBeenCalledWith(expect.stringMatching(/isn't verified/))
    expect(exec).toHaveBeenCalled()
  })

  it('waits while another installation is in progress', async () => {
    vi.mocked(exec).mockResolvedValueOnce(1618).mockResolvedValueOnce(1618)
    await ensurePackage({ kind: 'latest' }, '')
    expect(exec).toHaveBeenCalledTimes(3)
  })

  it('gives up when another installation never finishes', async () => {
    vi.mocked(exec).mockResolvedValue(1618)
    await expect(ensurePackage({ kind: 'latest' }, '')).rejects.toThrow(/still running/)
    expect(exec).toHaveBeenCalledTimes(20)
  })

  it.each([3010, 1641])('fails when msiexec exits with %i, which needs a restart', async (code) => {
    vi.mocked(exec).mockResolvedValue(code)
    await expect(ensurePackage({ kind: 'latest' }, '')).rejects.toThrow(/needs Windows to restart/)
  })

  it('fails with any other msiexec exit code', async () => {
    vi.mocked(exec).mockResolvedValue(1603)
    await expect(ensurePackage({ kind: 'latest' }, '')).rejects.toThrow(/exit code 1603/)
  })

  it('fails when wsl.exe reports a different release after the install', async () => {
    afterInstall = '2.7.14.0'
    await expect(ensurePackage({ kind: 'latest' }, '')).rejects.toThrow(/reports 2\.7\.14\.0/)
  })

  it('retries wsl --version while WSL finishes an upgrade', async () => {
    installed = '3.0.3.0'
    vi.mocked(wsl).mockResolvedValueOnce({ exitCode: 1, stdout: 'WSL is finishing an upgrade...' })
    await expect(ensurePackage({ kind: 'runner' }, '')).resolves.toMatchObject({
      package: '3.0.3.0',
    })
    expect(wsl).toHaveBeenCalledTimes(2)
  })
})
