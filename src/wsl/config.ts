import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as core from '@actions/core'
import { resolveInputPath } from '../files.js'
import { wsl } from './exe.js'

/**
 * The `.wslconfig` the action writes on GitHub-hosted runners by default. Jobs run without a
 * desktop session, so WSLg has nothing to show, and instances that stay up between steps keep
 * their services running instead of starting again for each step.
 */
export const RUNNER_WSLCONFIG = `# Written by froazin/action-wsl-setup for a GitHub-hosted runner.
[wsl2]
guiApplications=false

[general]
instanceIdleTimeout=-1
`

/** What the `wslconfig` input asks for. */
export type WslConfigRequest =
  | { kind: 'none' }
  | { kind: 'default' }
  | { kind: 'file'; content: string }

/** Parses the `wslconfig` input: `default`, `none` or a path, which it reads. */
export function parseWslConfigRequest(input: string): WslConfigRequest {
  const value = input.trim()
  if (value === '' || value === 'default') return { kind: 'default' }
  if (value === 'none') return { kind: 'none' }
  return { kind: 'file', content: readFileSync(resolveInputPath(value, 'wslconfig'), 'utf8') }
}

/** Where WSL reads `.wslconfig` from. */
export function wslconfigPath(): string {
  return join(process.env.USERPROFILE ?? homedir(), '.wslconfig')
}

/** What to do about `.wslconfig`: write content, or leave the file as it is. */
export type WslConfigPlan = { write: true; content: string } | { write: false; reason: string }

/**
 * Decides what to do about `.wslconfig`. The default is only written on GitHub-hosted runners,
 * because on a self-hosted runner it would outlive the job, and only over an existing file with
 * `overwrite`. A file from the workflow replaces an existing one only with `overwrite` too,
 * because on a self-hosted runner that file is someone's own.
 */
export function planWslConfig(
  request: WslConfigRequest,
  existing: string | undefined,
  hosted: boolean,
  overwrite: boolean,
): WslConfigPlan {
  if (request.kind === 'none') {
    return { write: false, reason: 'wslconfig is none, so the action leaves .wslconfig alone.' }
  }
  if (request.kind === 'default' && !hosted) {
    return {
      write: false,
      reason: "This isn't a GitHub-hosted runner, so the action leaves .wslconfig alone.",
    }
  }
  const content = request.kind === 'default' ? RUNNER_WSLCONFIG : request.content
  if (existing === undefined || overwrite) {
    return existing === content
      ? { write: false, reason: '.wslconfig already has this content.' }
      : { write: true, content }
  }
  if (existing === content) {
    return { write: false, reason: '.wslconfig already has this content.' }
  }
  if (request.kind === 'default') {
    return { write: false, reason: 'The runner already has a .wslconfig, so the action keeps it.' }
  }
  throw new Error(
    `${wslconfigPath()} already exists with other content, and the action won't replace it. Set wslconfig-overwrite to true to replace it.`,
  )
}

/**
 * Applies the `wslconfig` input. After writing a new file it shuts WSL down, because WSL only
 * reads `.wslconfig` when its virtual machine starts. Returns whether it wrote the file.
 */
export async function applyWslConfig(
  request: WslConfigRequest,
  overwrite: boolean,
): Promise<boolean> {
  const path = wslconfigPath()
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined
  const hosted = process.env.RUNNER_ENVIRONMENT === 'github-hosted'
  const plan = planWslConfig(request, existing, hosted, overwrite)
  if (!plan.write) {
    core.info(plan.reason)
    return false
  }
  writeFileSync(path, plan.content)
  core.info(`Wrote ${path}${existing === undefined ? '' : ', replacing the one that was there'}.`)

  const running = await wsl(['--list', '--running', '--quiet'], { silent: true })
  // It exits non-zero when nothing is running.
  const names =
    running.exitCode === 0
      ? running.stdout
          .split('\n')
          .map((name) => name.trim())
          .filter(Boolean)
      : []
  const shutdown = await wsl(['--shutdown'])
  if (shutdown.exitCode !== 0) {
    throw new Error(`wsl --shutdown failed, so WSL may not read the new .wslconfig.`)
  }
  if (names.length > 0) {
    core.warning(`Stopped ${names.join(', ')} so WSL reads the new .wslconfig.`)
  }
  return true
}
