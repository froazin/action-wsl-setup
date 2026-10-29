import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveInputPath } from '../src/files.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveInputPath', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'workspace-'))
  writeFileSync(join(workspace, 'file'), '')

  it('resolves a path against the workspace', () => {
    vi.stubEnv('GITHUB_WORKSPACE', workspace)
    expect(resolveInputPath('file', 'wslconfig')).toBe(join(workspace, 'file'))
  })

  it('keeps an absolute path', () => {
    expect(resolveInputPath(join(workspace, 'file'), 'wslconfig')).toBe(join(workspace, 'file'))
  })

  it('fails when the file is missing, naming the input', () => {
    vi.stubEnv('GITHUB_WORKSPACE', workspace)
    expect(() => resolveInputPath('missing', 'wslconfig')).toThrow(
      /wslconfig is missing, but .* doesn't exist/,
    )
  })
})
