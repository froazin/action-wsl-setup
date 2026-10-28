import * as core from '@actions/core'
import { describe, expect, it, vi } from 'vitest'
import { run } from '../src/main.js'

vi.mock('@actions/core')

describe('run', () => {
  it('says it has no behaviour yet', async () => {
    await run()
    expect(core.info).toHaveBeenCalledWith('action-wsl-setup has no behaviour yet.')
  })
})
