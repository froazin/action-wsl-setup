import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as core from '@actions/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyWslConfig,
  checkWslConfig,
  parseWslConfigRequest,
  planWslConfig,
  RUNNER_WSLCONFIG,
  wslconfigPath,
} from '../../src/wsl/config.js'
import { wsl } from '../../src/wsl/exe.js'

vi.mock('@actions/core')
vi.mock('../../src/wsl/exe.js')

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'home-'))
  vi.stubEnv('USERPROFILE', home)
  vi.stubEnv('GITHUB_WORKSPACE', home)
  // CI runs these tests on a GitHub-hosted runner, which sets it to github-hosted.
  vi.stubEnv('RUNNER_ENVIRONMENT', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('parseWslConfigRequest', () => {
  it.each(['', 'default', ' default '])('reads %j as the default', (input) => {
    expect(parseWslConfigRequest(input)).toEqual({ kind: 'default' })
  })

  it('reads none', () => {
    expect(parseWslConfigRequest('none')).toEqual({ kind: 'none' })
  })

  it('reads a path in the workspace', () => {
    writeFileSync(join(home, 'ci.wslconfig'), '[wsl2]\nmemory=4GB\n')
    expect(parseWslConfigRequest('ci.wslconfig')).toEqual({
      kind: 'file',
      content: '[wsl2]\nmemory=4GB\n',
    })
  })

  it('fails when the path is missing', () => {
    expect(() => parseWslConfigRequest('missing.wslconfig')).toThrow(/wslconfig is missing/)
  })
})

describe('planWslConfig', () => {
  const file = { kind: 'file', content: 'mine' } as const
  const fallback = { kind: 'default' } as const

  it('leaves .wslconfig alone with none', () => {
    expect(planWslConfig({ kind: 'none' }, undefined, true, true)).toMatchObject({ write: false })
  })

  it('writes the default on a hosted runner without a .wslconfig', () => {
    expect(planWslConfig(fallback, undefined, true, false)).toEqual({
      write: true,
      content: RUNNER_WSLCONFIG,
      replacing: false,
    })
  })

  it.each([false, true])(
    'never writes the default on a self-hosted runner (overwrite %s)',
    (overwrite) => {
      expect(planWslConfig(fallback, undefined, false, overwrite)).toEqual({
        write: false,
        reason: expect.stringMatching(/isn't a GitHub-hosted runner/),
      })
    },
  )

  it('keeps an existing .wslconfig with the default', () => {
    expect(planWslConfig(fallback, 'theirs', true, false)).toEqual({
      write: false,
      reason: expect.stringMatching(/keeps it/),
    })
  })

  it('replaces an existing .wslconfig with the default when told to', () => {
    expect(planWslConfig(fallback, 'theirs', true, true)).toMatchObject({ write: true })
  })

  it('writes a file on any runner', () => {
    expect(planWslConfig(file, undefined, false, false)).toEqual({
      write: true,
      content: 'mine',
      replacing: false,
    })
  })

  it("fails rather than replace someone else's .wslconfig", () => {
    expect(() => planWslConfig(file, 'theirs', false, false)).toThrow(
      /already exists with other content.*wslconfig-overwrite/,
    )
  })

  it('replaces it when told to', () => {
    expect(planWslConfig(file, 'theirs', false, true)).toEqual({
      write: true,
      content: 'mine',
      replacing: true,
    })
  })

  it.each([false, true])("doesn't rewrite identical content (overwrite %s)", (overwrite) => {
    expect(planWslConfig(file, 'mine', false, overwrite)).toMatchObject({ write: false })
  })
})

describe('checkWslConfig', () => {
  it('plans from the .wslconfig that is there and the kind of runner', () => {
    vi.stubEnv('RUNNER_ENVIRONMENT', 'github-hosted')
    writeFileSync(wslconfigPath(), 'theirs')
    expect(checkWslConfig({ kind: 'default' }, true)).toEqual({
      write: true,
      content: RUNNER_WSLCONFIG,
      replacing: true,
    })
  })

  it('treats any other runner as self-hosted', () => {
    expect(checkWslConfig({ kind: 'default' }, false)).toMatchObject({ write: false })
  })

  it("fails rather than replace someone else's .wslconfig", () => {
    writeFileSync(wslconfigPath(), 'theirs')
    expect(() => checkWslConfig({ kind: 'file', content: 'mine' }, false)).toThrow(
      /wslconfig-overwrite/,
    )
  })
})

describe('applyWslConfig', () => {
  const plan = { write: true, content: RUNNER_WSLCONFIG, replacing: false } as const

  beforeEach(() => {
    vi.mocked(wsl).mockImplementation(async (args) =>
      args.includes('--running')
        ? { exitCode: 1, stdout: 'There are no running distributions.\n' }
        : { exitCode: 0, stdout: '' },
    )
  })

  it('writes the file and shuts WSL down', async () => {
    await expect(applyWslConfig(plan)).resolves.toBe(true)
    expect(readFileSync(wslconfigPath(), 'utf8')).toBe(RUNNER_WSLCONFIG)
    expect(wsl).toHaveBeenCalledWith(['--shutdown'])
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('warns about the instances it stopped', async () => {
    vi.mocked(wsl).mockResolvedValue({ exitCode: 0, stdout: 'Ubuntu-26.04\r\nci\n' })
    await applyWslConfig(plan)
    expect(core.warning).toHaveBeenCalledWith(
      'Stopped Ubuntu-26.04, ci so WSL reads the new .wslconfig.',
    )
  })

  it("doesn't write or shut down when the plan says not to", async () => {
    await expect(applyWslConfig({ write: false, reason: 'none' })).resolves.toBe(false)
    expect(existsSync(wslconfigPath())).toBe(false)
    expect(wsl).not.toHaveBeenCalled()
  })

  it('fails when wsl --shutdown fails', async () => {
    vi.mocked(wsl).mockResolvedValue({ exitCode: 1, stdout: '' })
    await expect(applyWslConfig(plan)).rejects.toThrow(/wsl --shutdown failed/)
  })
})
