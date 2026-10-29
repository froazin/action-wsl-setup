import * as core from '@actions/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { judge, parseTimeout, provision } from '../../src/cloudinit/provision.js'
import { type WslResult, wsl, wslWithTimeout } from '../../src/wsl/exe.js'

vi.mock('@actions/core')
vi.mock('../../src/wsl/exe.js')

const WSL = { datasource: 'DataSourceWSL' }

describe('parseTimeout', () => {
  it.each([
    ['', 15],
    ['30', 30],
    [' 2.5 ', 2.5],
  ])('parses %j as %d minutes', (input, minutes) => {
    expect(parseTimeout(input)).toBe(minutes)
  })

  it.each(['0', '-1', 'ten', 'Infinity'])('rejects %j', (input) => {
    expect(() => parseTimeout(input)).toThrow(/cloud-init-timeout/)
  })
})

describe('judge', () => {
  const finished = (extra = {}) => ({ result: { v1: { ...WSL, errors: [], ...extra } } })

  it('passes a clean run', () => {
    expect(judge({ ...finished(), status: { errors: [], recoverable_errors: {} } }, false)).toBe(
      'done',
    )
  })

  it('fails when cloud-init never finished a run', () => {
    expect(() => judge({ status: { errors: [] } }, false)).toThrow(/didn't finish a run/)
  })

  it('fails when cloud-init used another datasource', () => {
    expect(() => judge({ result: { v1: { datasource: 'DataSourceNone' } } }, false)).toThrow(
      /ran with DataSourceNone, not the WSL datasource/,
    )
  })

  it('fails with the errors from both, once each', () => {
    const run = {
      ...finished({ errors: ['runcmd failed'] }),
      status: { errors: ['runcmd failed', 'boom'] },
    }
    expect(() => judge(run, true)).toThrow('cloud-init failed: runcmd failed; boom')
  })

  // Observed on Ubuntu-26.04: result.json had no recoverable errors, but status listed each twice.
  const deprecated = {
    ...finished(),
    status: {
      errors: [],
      recoverable_errors: {
        DEPRECATED: ['users.0.uid is a string', 'users.0.uid is a string'],
        WARNING: ['cloud-config failed schema validation!'],
      },
    },
  }

  it('fails a run that only status reports as degraded', () => {
    expect(() => judge(deprecated, false)).toThrow(
      'cloud-init finished degraded: DEPRECATED: users.0.uid is a string; WARNING: cloud-config failed schema validation!. Set allow-degraded to true to accept that.',
    )
  })

  it('accepts a degraded run with a warning when allowed', () => {
    expect(judge(deprecated, true)).toBe('degraded')
    expect(core.warning).toHaveBeenCalledWith(expect.stringMatching(/DEPRECATED: users\.0\.uid/))
  })

  it('reads recoverable errors from result.json too', () => {
    const run = finished({ recoverable_errors: { WARNING: ['old key'] } })
    expect(() => judge(run, false)).toThrow(/WARNING: old key/)
  })
})

describe('provision', () => {
  /** What each kind of command in the instance returns. */
  let responses: {
    commandV: WslResult
    result: WslResult
    status: WslResult
    systemd: string
    failed: WslResult
  }

  beforeEach(() => {
    responses = {
      commandV: { exitCode: 0, stdout: '/usr/bin/cloud-init\n' },
      result: { exitCode: 0, stdout: JSON.stringify({ v1: { ...WSL, errors: [] } }) },
      status: { exitCode: 0, stdout: JSON.stringify({ status: 'disabled', errors: [] }) },
      systemd: 'running\n',
      failed: { exitCode: 0, stdout: '0 loaded units listed.\n' },
    }
    vi.mocked(core.group).mockImplementation(async (_name, fn) => fn())
    vi.mocked(wsl).mockImplementation(async (args) => {
      const command = args.join(' ')
      if (command.includes('command -v cloud-init')) return responses.commandV
      if (command.includes('result.json')) return responses.result
      if (command.includes('--format json')) return responses.status
      if (command.includes('systemctl --failed')) return responses.failed
      return { exitCode: 0, stdout: '' }
    })
    vi.mocked(wslWithTimeout).mockImplementation(async (args) => ({
      exitCode: 0,
      stdout: args.join(' ').includes('is-system-running') ? responses.systemd : '',
      timedOut: false,
    }))
  })

  it('waits, judges, shows the log and restarts the instance', async () => {
    await expect(provision('ci', 15, false)).resolves.toBe('done')
    expect(wslWithTimeout).toHaveBeenCalledWith(
      ['-d', 'ci', '-u', 'root', '--', 'cloud-init', 'status', '--wait'],
      900_000,
    )
    expect(wsl).toHaveBeenCalledWith(
      expect.arrayContaining(['-d', 'ci', 'sh', '-c', expect.stringMatching(/cloud-init-output/)]),
    )
    expect(wsl).toHaveBeenCalledWith(['--terminate', 'ci'])
  })

  it('fails when the instance has no cloud-init', async () => {
    responses.commandV = { exitCode: 1, stdout: '' }
    await expect(provision('FedoraLinux-44', 15, false)).rejects.toThrow(
      /FedoraLinux-44 has no cloud-init/,
    )
    expect(wslWithTimeout).not.toHaveBeenCalled()
  })

  it('fails on a timeout, and still shows the log', async () => {
    vi.mocked(wslWithTimeout).mockResolvedValue({ exitCode: 1, stdout: '', timedOut: true })
    await expect(provision('ci', 2, false)).rejects.toThrow(/within 2 minutes/)
    expect(core.group).toHaveBeenCalledWith('cloud-init log for ci', expect.any(Function))
  })

  it('fails when cloud-init failed, and still shows the log', async () => {
    responses.result.stdout = JSON.stringify({ v1: { ...WSL, errors: ['runcmd failed'] } })
    await expect(provision('ci', 15, false)).rejects.toThrow('cloud-init failed: runcmd failed')
    expect(core.group).toHaveBeenCalledWith('cloud-init log for ci', expect.any(Function))
    expect(wsl).not.toHaveBeenCalledWith(['--terminate', 'ci'])
  })

  it('fails when status reports a degraded run, although it exits 2', async () => {
    responses.status = {
      exitCode: 2,
      stdout: JSON.stringify({ errors: [], recoverable_errors: { DEPRECATED: ['old key'] } }),
    }
    await expect(provision('ci', 15, false)).rejects.toThrow(/DEPRECATED: old key/)
  })

  it('fails when systemd is degraded after the restart', async () => {
    responses.systemd = 'degraded\n'
    await expect(provision('ci', 15, false)).rejects.toThrow(/systemd is degraded.*allow-degraded/)
  })

  it('accepts a degraded systemd when allowed', async () => {
    responses.systemd = 'degraded\n'
    await expect(provision('ci', 15, true)).resolves.toBe('done')
    expect(core.warning).toHaveBeenCalledWith(expect.stringMatching(/systemd is degraded/))
  })

  it('fails when systemd never started, even when degraded is allowed', async () => {
    responses.systemd = 'offline\n'
    await expect(provision('ci', 15, true)).rejects.toThrow(/systemd is offline/)
  })

  it('accepts an instance without systemd', async () => {
    responses.systemd = 'no-systemd\n'
    await expect(provision('ci', 15, false)).resolves.toBe('done')
  })
})
