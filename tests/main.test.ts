import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { provision } from '../src/cloudinit/provision.js'
import { placeSeed } from '../src/cloudinit/seed.js'
import { downloadImage } from '../src/distro/download.js'
import { installImage, listInstances } from '../src/distro/install.js'
import { fetchManifest } from '../src/distro/manifest.js'
import { run } from '../src/main.js'
import { nativeArch, wslcPath } from '../src/wsl/exe.js'
import { ensurePackage } from '../src/wsl/package.js'

vi.mock('@actions/core')
vi.mock('../src/wsl/package.js')
vi.mock('../src/wsl/exe.js')
vi.mock('../src/distro/download.js')
vi.mock('../src/cloudinit/provision.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/cloudinit/provision.js')>()),
  provision: vi.fn(),
}))
vi.mock('../src/cloudinit/seed.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/cloudinit/seed.js')>()),
  placeSeed: vi.fn(),
  readInputFile: vi.fn((path: string) => `contents of ${path}`),
}))
vi.mock('../src/distro/manifest.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/distro/manifest.js')>()),
  fetchManifest: vi.fn(),
}))
vi.mock('../src/distro/install.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/distro/install.js')>()),
  installImage: vi.fn(),
  listInstances: vi.fn(),
}))

const SHA = 'a'.repeat(64)
const removeSeed = vi.fn()

describe('run', () => {
  const inputs: Record<string, string> = {}

  beforeEach(() => {
    inputs.cache = 'true'
    vi.mocked(core.getInput).mockImplementation((name) => inputs[name] ?? '')
    vi.mocked(core.getBooleanInput).mockImplementation((name) => inputs[name] === 'true')
    vi.mocked(core.group).mockImplementation(async (_name, fn) => fn())
    vi.mocked(ensurePackage).mockResolvedValue({ package: '3.0.3.0', kernel: '6.18.54.1-1' })
    vi.mocked(wslcPath).mockReturnValue('C:\\Program Files\\WSL\\wslc.exe')
    vi.mocked(nativeArch).mockResolvedValue('x64')
    vi.mocked(listInstances).mockResolvedValue([])
    vi.mocked(fetchManifest).mockResolvedValue({
      ModernDistributions: {
        Ubuntu: [
          { Name: 'Ubuntu-26.04', Amd64Url: { Url: 'https://example.com/u.wsl', Sha256: SHA } },
        ],
      },
    })
    vi.mocked(downloadImage).mockResolvedValue({ path: 'D:\\a\\_temp\\u.wsl', cacheHit: true })
    vi.mocked(provision).mockResolvedValue('done')
    vi.mocked(placeSeed).mockReturnValue(removeSeed)
    Object.defineProperty(process, 'platform', { value: 'win32' })
  })

  afterEach(() => {
    for (const key of Object.keys(inputs)) delete inputs[key]
  })

  it('sets the outputs from the installed package', async () => {
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith('wsl-package-version', '3.0.3.0')
    expect(core.setOutput).toHaveBeenCalledWith('kernel-version', '6.18.54.1-1')
    expect(core.setOutput).toHaveBeenCalledWith('wslc-path', 'C:\\Program Files\\WSL\\wslc.exe')
  })

  it("doesn't install a distribution unless one is asked for", async () => {
    await run()
    expect(fetchManifest).not.toHaveBeenCalled()
    expect(installImage).not.toHaveBeenCalled()
  })

  it('passes the package request and token on', async () => {
    inputs['wsl-package-version'] = '2.7.14'
    inputs.token = 'secret'
    await run()
    expect(ensurePackage).toHaveBeenCalledWith({ kind: 'exact', tag: '2.7.14' }, 'secret')
  })

  it('sets an empty wslc-path when the package has no wslc.exe', async () => {
    vi.mocked(wslcPath).mockReturnValue(undefined)
    await run()
    expect(core.setOutput).toHaveBeenCalledWith('wslc-path', '')
  })

  it('installs a distribution under its own name as WSL 2 by default', async () => {
    inputs.distribution = 'Ubuntu-26.04'
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(downloadImage).toHaveBeenCalledWith(expect.objectContaining({ sha256: SHA }), true)
    expect(installImage).toHaveBeenCalledWith('Ubuntu-26.04', 'D:\\a\\_temp\\u.wsl', 2)
    expect(core.setOutput).toHaveBeenCalledWith('instance-name', 'Ubuntu-26.04')
    expect(core.setOutput).toHaveBeenCalledWith('cache-hit', 'true')
  })

  it('installs under another name, as WSL 1, without the cache', async () => {
    inputs.distribution = 'ubuntu-26.04'
    inputs['instance-name'] = 'ci'
    inputs['wsl-version'] = '1'
    inputs.cache = 'false'
    await run()
    expect(downloadImage).toHaveBeenCalledWith(expect.anything(), false)
    expect(installImage).toHaveBeenCalledWith('ci', 'D:\\a\\_temp\\u.wsl', 1)
  })

  it('refuses to replace an existing instance', async () => {
    inputs.distribution = 'Ubuntu-26.04'
    vi.mocked(listInstances).mockResolvedValue([{ name: 'ubuntu-26.04', version: 2 }])
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/already has an instance/))
    expect(installImage).not.toHaveBeenCalled()
  })

  it('checks the inputs before changing the runner', async () => {
    inputs.distribution = 'Ubuntu-26.04'
    inputs['wsl-version'] = '3'
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/wsl-version must be 1 or 2/))
    expect(ensurePackage).not.toHaveBeenCalled()
  })

  it('checks the instance name before changing the runner', async () => {
    inputs.distribution = 'Ubuntu-26.04'
    inputs['instance-name'] = 'has space'
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/valid instance name/))
    expect(ensurePackage).not.toHaveBeenCalled()
  })

  it('places the seed before the install, provisions and removes the seed', async () => {
    inputs.distribution = 'Ubuntu-26.04'
    inputs['cloud-init-user-data'] = 'user-data'
    inputs['cloud-init-timeout'] = '20'
    await run()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(placeSeed).toHaveBeenCalledWith('Ubuntu-26.04', {
      userData: 'contents of user-data',
      metaData: 'instance-id: Ubuntu-26.04\n',
    })
    expect(vi.mocked(placeSeed).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(installImage).mock.invocationCallOrder[0] ?? 0,
    )
    expect(provision).toHaveBeenCalledWith('Ubuntu-26.04', 20, false)
    expect(core.setOutput).toHaveBeenCalledWith('cloud-init-status', 'done')
    expect(removeSeed).toHaveBeenCalled()
  })

  it('removes the seed when provisioning fails', async () => {
    inputs.distribution = 'Ubuntu-26.04'
    inputs['cloud-init-user-data'] = 'user-data'
    vi.mocked(provision).mockRejectedValue(new Error('cloud-init failed: boom'))
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('cloud-init failed: boom')
    expect(removeSeed).toHaveBeenCalled()
  })

  it.each([
    [{ 'cloud-init-user-data': 'u' }, /needs a distribution/],
    [{ distribution: 'Ubuntu-26.04', 'cloud-init-meta-data': 'm' }, /needs cloud-init-user-data/],
    [
      { distribution: 'Ubuntu-26.04', 'cloud-init-user-data': 'u', 'wsl-version': '1' },
      /cloud-init needs WSL 2/,
    ],
    [{ 'cloud-init-timeout': 'soon' }, /cloud-init-timeout/],
  ])('checks the cloud-init inputs before changing the runner: %j', async (given, message) => {
    Object.assign(inputs, given)
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(message))
    expect(ensurePackage).not.toHaveBeenCalled()
  })

  it('fails on a runner that is not Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('WSL runs on Windows, but this runner is linux.')
    expect(ensurePackage).not.toHaveBeenCalled()
  })

  it('fails on a bad wsl-package-version', async () => {
    inputs['wsl-package-version'] = 'newest'
    await run()
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringMatching(/wsl-package-version/))
  })

  it('fails with the error from setting up the package', async () => {
    vi.mocked(ensurePackage).mockRejectedValue(new Error('msiexec failed'))
    await run()
    expect(core.setFailed).toHaveBeenCalledWith('msiexec failed')
  })
})
