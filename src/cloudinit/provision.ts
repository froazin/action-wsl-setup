import * as core from '@actions/core'
import { wsl, wslWithTimeout } from '../wsl/exe.js'

/** How a cloud-init run ended, when it didn't fail. */
export type CloudInitStatus = 'done' | 'degraded'

/** Errors cloud-init records, by level for recoverable ones such as DEPRECATED and WARNING. */
interface Problems {
  errors?: string[]
  recoverable_errors?: Record<string, string[]>
}

/** What the action reads about a cloud-init run. */
export interface CloudInitRun {
  /** result.json, which cloud-init writes when its last stage finishes. */
  result?: { v1?: Problems & { datasource?: string | null } }
  /** The output of `cloud-init status --format json`, which gathers every stage's problems. */
  status?: Problems
}

/** Where cloud-init writes its result when its last stage finishes. */
const RESULT = '/var/lib/cloud/data/result.json'

/** Parses the `cloud-init-timeout` input, in minutes. Empty means 15. */
export function parseTimeout(input: string): number {
  const value = input.trim()
  if (value === '') return 15
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`cloud-init-timeout must be a number of minutes above 0, not "${value}".`)
  }
  return minutes
}

/** True when the instance has cloud-init. Running the check starts the instance. */
export async function hasCloudInit(instance: string): Promise<boolean> {
  const result = await wsl([
    '-d',
    instance,
    '-u',
    'root',
    '--',
    'sh',
    '-c',
    'command -v cloud-init',
  ])
  return result.exitCode === 0
}

/**
 * Waits for cloud-init to finish in the instance. One wsl.exe process waits the whole time, so
 * a client stays attached and WSL doesn't stop the idle instance part way through.
 */
export async function waitForCloudInit(instance: string, minutes: number): Promise<void> {
  const args = ['-d', instance, '-u', 'root', '--', 'cloud-init', 'status', '--wait']
  const result = await wslWithTimeout(args, minutes * 60_000)
  if (result.timedOut) {
    throw new Error(
      `cloud-init didn't finish in ${instance} within ${minutes} minutes. Raise cloud-init-timeout if it needs longer.`,
    )
  }
}

/** Reads result.json and `cloud-init status` from the instance. */
export async function readRun(instance: string): Promise<CloudInitRun> {
  const result = await wsl(['-d', instance, '-u', 'root', '--', 'cat', RESULT], { silent: true })
  const status = await wsl(
    ['-d', instance, '-u', 'root', '--', 'cloud-init', 'status', '--format', 'json'],
    {
      silent: true,
    },
  )
  return {
    result: result.exitCode === 0 ? parseJson(result.stdout) : undefined,
    // status exits 1 or 2 for errors and recoverable errors, and still prints the JSON.
    status: parseJson(status.stdout),
  }
}

function parseJson<T>(output: string): T | undefined {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  try {
    return start === -1 ? undefined : (JSON.parse(output.slice(start, end + 1)) as T)
  } catch {
    return undefined
  }
}

/**
 * Judges a cloud-init run. result.json shows that a run finished and which datasource it used.
 * Its errors don't include recoverable ones, such as deprecated keys (observed), so those come
 * from `cloud-init status` too. status alone isn't enough: some distributions turn cloud-init off
 * after its first run, and then it says "disabled" whether or not cloud-init ran (observed on
 * Ubuntu-26.04).
 */
export function judge(run: CloudInitRun, allowDegraded: boolean): CloudInitStatus {
  const result = run.result?.v1
  if (!result) {
    throw new Error(
      `cloud-init didn't finish a run, so it may not have found the seed files. Its log is above.`,
    )
  }
  if (!result.datasource?.includes('WSL')) {
    throw new Error(
      `cloud-init ran with ${result.datasource ?? 'no datasource'}, not the WSL datasource, so it didn't use the user-data.`,
    )
  }
  const errors = unique([...(result.errors ?? []), ...(run.status?.errors ?? [])])
  if (errors.length > 0) {
    throw new Error(`cloud-init failed: ${errors.join('; ')}`)
  }
  const warnings = unique(
    [result.recoverable_errors, run.status?.recoverable_errors].flatMap((levels) =>
      Object.entries(levels ?? {}).flatMap(([level, messages]) =>
        messages.map((message) => `${level}: ${message}`),
      ),
    ),
  )
  if (warnings.length === 0) {
    return 'done'
  }
  const summary = `cloud-init finished degraded: ${warnings.join('; ')}`
  if (!allowDegraded) {
    throw new Error(`${summary}. Set allow-degraded to true to accept that.`)
  }
  core.warning(summary)
  return 'degraded'
}

/** cloud-init reports some problems more than once, so keep the first of each. */
function unique(messages: string[]): string[] {
  return [...new Set(messages)]
}

/** Shows cloud-init's status and output log, in a collapsed group. */
export async function showLogs(instance: string): Promise<void> {
  const script = 'cloud-init status --long; echo; tail -n 200 /var/log/cloud-init-output.log'
  await core.group(`cloud-init log for ${instance}`, () =>
    wsl(['-d', instance, '-u', 'root', '--', 'sh', '-c', script]),
  )
}

/**
 * Restarts the instance so cloud-init's changes to /etc/wsl.conf take effect, such as the default
 * user or systemd, then checks systemd started cleanly when it's running.
 */
export async function restart(instance: string, allowDegraded: boolean): Promise<void> {
  await wsl(['--terminate', instance])
  const script =
    'if [ "$(cat /proc/1/comm)" = systemd ]; then systemctl is-system-running --wait; else echo no-systemd; fi'
  const result = await wslWithTimeout(
    ['-d', instance, '-u', 'root', '--', 'sh', '-c', script],
    300_000,
  )
  const state = result.stdout.trim().split('\n').at(-1) ?? ''
  core.info(`After a restart, ${instance}'s systemd state is ${state || 'unknown'}.`)
  if (state === 'running' || state === 'no-systemd') {
    return
  }
  const failed = await wsl([
    '-d',
    instance,
    '-u',
    'root',
    '--',
    'systemctl',
    '--failed',
    '--no-pager',
  ])
  const summary = `systemd is ${state || 'not running'} in ${instance} after cloud-init`
  if (state !== 'degraded' || !allowDegraded) {
    throw new Error(
      state === 'degraded'
        ? `${summary}, because of the failed units above. Set allow-degraded to true to accept that.`
        : `${summary}. ${failed.stdout.trim()}`,
    )
  }
  core.warning(`${summary}, because of the failed units above.`)
}

/**
 * Provisions a newly installed instance with the seed placed for it: starts it, waits for
 * cloud-init, judges the run and restarts the instance. cloud-init's log is shown whether it
 * worked or not.
 */
export async function provision(
  instance: string,
  minutes: number,
  allowDegraded: boolean,
): Promise<CloudInitStatus> {
  if (!(await hasCloudInit(instance))) {
    throw new Error(
      `${instance} has no cloud-init, so it can't use cloud-init-user-data. Use a distribution whose image includes cloud-init.`,
    )
  }
  core.info(`Waiting up to ${minutes} minutes for cloud-init to finish in ${instance}.`)
  let status: CloudInitStatus
  try {
    await waitForCloudInit(instance, minutes)
    status = judge(await readRun(instance), allowDegraded)
  } finally {
    await showLogs(instance)
  }
  await restart(instance, allowDegraded)
  return status
}
