import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../src/main.js'
import { wslcPath } from '../src/wsl/exe.js'
import { ensurePackage } from '../src/wsl/package.js'

vi.mock('@actions/core')
vi.mock('../src/wsl/package.js')
vi.mock('../src/wsl/exe.js')

describe('run', () => {
  const inputs: Record<string, string> = {}

  beforeEach(() => {
    vi.mocked(core.getInput).mockImplementation((name) => inputs[name] ?? '')
    vi.mocked(ensurePackage).mockResolvedValue({ package: '3.0.3.0', kernel: '6.18.54.1-1' })
    vi.mocked(wslcPath).mockReturnValue('C:\\Program Files\\WSL\\wslc.exe')
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
