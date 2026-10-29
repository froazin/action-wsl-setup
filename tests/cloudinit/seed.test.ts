import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSeed,
  normalise,
  placeSeed,
  readInputFile,
  seedDir,
} from '../../src/cloudinit/seed.js'

vi.mock('@actions/core')

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'home-'))
  vi.stubEnv('USERPROFILE', home)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('normalise', () => {
  it('removes a byte order mark and CRLF line endings', () => {
    expect(normalise('﻿#cloud-config\r\nusers: []\r\n')).toBe('#cloud-config\nusers: []\n')
  })
})

describe('readInputFile', () => {
  it('reads a path relative to the workspace', () => {
    vi.stubEnv('GITHUB_WORKSPACE', home)
    writeFileSync(join(home, 'user-data'), '#cloud-config\r\n')
    expect(readInputFile('user-data', 'cloud-init-user-data')).toBe('#cloud-config\n')
  })

  it('fails when the file is missing', () => {
    vi.stubEnv('GITHUB_WORKSPACE', home)
    expect(() => readInputFile('missing', 'cloud-init-user-data')).toThrow(
      /cloud-init-user-data is missing, but .* doesn't exist/,
    )
  })
})

describe('buildSeed', () => {
  it('names the instance-id after the instance when there is no meta-data', () => {
    expect(buildSeed('ci', '#cloud-config\n')).toEqual({
      userData: '#cloud-config\n',
      metaData: 'instance-id: ci\n',
    })
  })

  it('keeps the meta-data it is given', () => {
    expect(buildSeed('ci', 'u', 'instance-id: mine\n').metaData).toBe('instance-id: mine\n')
  })
})

describe('placeSeed', () => {
  const seed = { userData: '#cloud-config\n', metaData: 'instance-id: ci\n' }

  it('writes the seed files and removes them afterwards', () => {
    const remove = placeSeed('ci', seed)
    const userData = join(seedDir(), 'ci.user-data')
    expect(readFileSync(userData, 'utf8')).toBe(seed.userData)
    expect(readFileSync(join(seedDir(), 'ci.meta-data'), 'utf8')).toBe(seed.metaData)
    remove()
    expect(existsSync(userData)).toBe(false)
  })

  it("refuses to replace someone else's seed file", () => {
    mkdirSync(seedDir(), { recursive: true })
    writeFileSync(join(seedDir(), 'ci.user-data'), '#cloud-config\npackages: [git]\n')
    expect(() => placeSeed('ci', seed)).toThrow(/already exists with other content/)
    expect(existsSync(join(seedDir(), 'ci.meta-data'))).toBe(false)
  })

  it('leaves an identical seed file in place, before and after', () => {
    mkdirSync(seedDir(), { recursive: true })
    const userData = join(seedDir(), 'ci.user-data')
    writeFileSync(userData, '#cloud-config\r\n')
    const remove = placeSeed('ci', seed)
    remove()
    expect(existsSync(userData)).toBe(true)
    expect(existsSync(join(seedDir(), 'ci.meta-data'))).toBe(false)
  })
})
