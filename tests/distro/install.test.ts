import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkInstanceName,
  explainInstallError,
  installImage,
  parseInstances,
  parseWslVersion,
} from '../../src/distro/install.js'
import { wsl } from '../../src/wsl/exe.js'

vi.mock('../../src/wsl/exe.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/wsl/exe.js')>()),
  wsl: vi.fn(),
}))

// Captured from `wsl --list --verbose` on windows-2022 (observed).
const LIST = `  NAME              STATE           VERSION
* probe2            Stopped         2
  FedoraLinux-44    Running         2
  probe1            Stopped         1
`

// Captured from a WSL 2 install on windows-11-arm (observed).
const NO_VIRTUALISATION = `WSL2 is unable to start since virtualization is not enabled on this machine.
Error code: Wsl/InstallDistro/Service/RegisterDistro/CreateVm/HCS/HCS_E_HYPERV_NOT_INSTALLED
`

describe('parseWslVersion', () => {
  it.each([
    ['', 2],
    ['2', 2],
    [' 1 ', 1],
  ])('parses %j as %i', (input, version) => {
    expect(parseWslVersion(input)).toBe(version)
  })

  it.each(['3', 'v2', 'two'])('rejects %j', (input) => {
    expect(() => parseWslVersion(input)).toThrow(/must be 1 or 2/)
  })
})

describe('checkInstanceName', () => {
  it.each(['Ubuntu-26.04', 'ci_test', 'a'])('accepts %j', (name) => {
    expect(() => checkInstanceName(name)).not.toThrow()
  })

  it.each(['', '-x', 'has space', 'a/b', '..'])('rejects %j', (name) => {
    expect(() => checkInstanceName(name)).toThrow(/valid instance name/)
  })
})

describe('parseInstances', () => {
  it('reads each instance and its version', () => {
    expect(parseInstances(LIST)).toEqual([
      { name: 'probe2', version: 2 },
      { name: 'FedoraLinux-44', version: 2 },
      { name: 'probe1', version: 1 },
    ])
  })

  it('reads a list with a translated header', () => {
    const german = '  NAME      STATUS          VERSION\n* Ubuntu    Wird ausgeführt 2\n'
    expect(parseInstances(german)).toEqual([{ name: 'Ubuntu', version: 2 }])
  })

  it('returns nothing when there are no instances', () => {
    const none = `Windows Subsystem for Linux has no installed distributions.
Use 'wsl.exe --list --online' to list available distributions
and 'wsl.exe --install <Distro>' to install.
`
    expect(parseInstances(none)).toEqual([])
  })
})

describe('explainInstallError', () => {
  it('suggests WSL 1 when WSL 2 has no virtualisation', () => {
    expect(explainInstallError(NO_VIRTUALISATION, 'Ubuntu-26.04', 2)).toMatch(
      /no virtualisation .*HCS_E_HYPERV_NOT_INSTALLED.*Set wsl-version to 1/,
    )
  })

  it("doesn't suggest WSL 1 when that's what failed", () => {
    expect(explainInstallError(NO_VIRTUALISATION, 'Ubuntu-26.04', 1)).toBe(
      "wsl.exe couldn't install Ubuntu-26.04 (Wsl/InstallDistro/Service/RegisterDistro/CreateVm/HCS/HCS_E_HYPERV_NOT_INSTALLED). Its output is above.",
    )
  })

  it('works without an error code', () => {
    expect(explainInstallError('Something went wrong.', 'X', 2)).toBe(
      "wsl.exe couldn't install X. Its output is above.",
    )
  })
})

describe('installImage', () => {
  beforeEach(() => {
    vi.mocked(wsl).mockImplementation(async (args) =>
      args[0] === '--install' ? { exitCode: 0, stdout: '' } : { exitCode: 0, stdout: LIST },
    )
  })

  it('installs from the file without starting the instance', async () => {
    await installImage('FedoraLinux-44', 'D:\\a\\_temp\\f.wsl', 2)
    expect(wsl).toHaveBeenCalledWith([
      '--install',
      '--from-file',
      'D:\\a\\_temp\\f.wsl',
      '--name',
      'FedoraLinux-44',
      '--version',
      '2',
      '--no-launch',
    ])
  })

  it('explains a failed install', async () => {
    vi.mocked(wsl).mockResolvedValueOnce({ exitCode: 4294967295, stdout: NO_VIRTUALISATION })
    await expect(installImage('Ubuntu-26.04', 'u.wsl', 2)).rejects.toThrow(/Set wsl-version to 1/)
  })

  it('fails when the instance is missing afterwards', async () => {
    await expect(installImage('Missing', 'm.wsl', 2)).rejects.toThrow(/isn't in wsl --list/)
  })

  it('fails when the instance has the wrong WSL version', async () => {
    await expect(installImage('probe1', 'p.wsl', 2)).rejects.toThrow(/as WSL 1, not WSL 2/)
  })
})
