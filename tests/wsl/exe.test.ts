import { getExecOutput } from '@actions/exec'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clean, parseErrorCode, parseVersion, wsl } from '../../src/wsl/exe.js'

vi.mock('@actions/exec')

// Captured from `wsl --version` on windows-2025 (observed).
const VERSION_OUTPUT = `WSL version: 3.0.3.0
Kernel version: 6.18.54.1-1
WSLg version: 1.0.79
MSRDC version: 1.2.7391
Direct3D version: 1.611.1-81528511
DXCore version: 10.0.26100.1-240331-1435.ge-release
Windows version: 10.0.26100.33650
`

describe('parseVersion', () => {
  it('reads the package and kernel versions', () => {
    expect(parseVersion(VERSION_OUTPUT)).toEqual({ package: '3.0.3.0', kernel: '6.18.54.1-1' })
  })

  it('reads translated labels by position', () => {
    const german = 'WSL-Version: 2.7.14.0\r\nKernelversion: 6.6.87.2-1\r\nWSLg-Version: 1.0.66\r\n'
    expect(parseVersion(german)).toEqual({ package: '2.7.14.0', kernel: '6.6.87.2-1' })
  })

  it('skips the upgrade notice wsl.exe prints first after an install', () => {
    const output = `WSL is finishing an upgrade...\n${VERSION_OUTPUT}`
    expect(parseVersion(output)?.package).toBe('3.0.3.0')
  })

  it('reads UTF-16LE output that was decoded as UTF-8', () => {
    const utf16 = Buffer.from(VERSION_OUTPUT, 'utf16le').toString('latin1')
    expect(parseVersion(utf16)?.package).toBe('3.0.3.0')
  })

  it("returns undefined for the inbox stub's message", () => {
    const stub =
      "The Windows Subsystem for Linux is not installed. You can install by running 'wsl.exe --install'."
    expect(parseVersion(stub)).toBeUndefined()
  })
})

describe('parseErrorCode', () => {
  it('finds the error code', () => {
    const output = `WSL2 is unable to start since virtualization is not enabled on this machine.
Error code: Wsl/InstallDistro/Service/RegisterDistro/CreateVm/HCS/HCS_E_HYPERV_NOT_INSTALLED
`
    expect(parseErrorCode(output)).toBe(
      'Wsl/InstallDistro/Service/RegisterDistro/CreateVm/HCS/HCS_E_HYPERV_NOT_INSTALLED',
    )
  })

  it('returns undefined without one', () => {
    expect(parseErrorCode('The operation completed successfully.')).toBeUndefined()
  })
})

describe('clean', () => {
  it('removes NULs and carriage returns', () => {
    expect(clean('a\0b\r\n')).toBe('ab\n')
  })
})

describe('wsl', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('quotes the path, which has a space, and closes stdin', async () => {
    vi.stubEnv('ProgramFiles', 'C:\\Program Files')
    vi.mocked(getExecOutput).mockResolvedValue({ exitCode: 0, stdout: 'ok\r\n', stderr: '' })
    const result = await wsl(['--version'])
    const [command, args, options] = vi.mocked(getExecOutput).mock.calls[0] ?? []
    expect(command).toMatch(/^"C:\\Program Files[\\/]WSL[\\/]wsl\.exe"$/)
    expect(args).toEqual(['--version'])
    expect(options?.input).toEqual(Buffer.alloc(0))
    expect(options?.env?.WSL_UTF8).toBe('1')
    expect(result).toEqual({ exitCode: 0, stdout: 'ok\n' })
  })
})
