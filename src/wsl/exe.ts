import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getExecOutput } from '@actions/exec'

/** The output of one wsl.exe run. */
export interface WslResult {
  exitCode: number
  stdout: string
}

/** Path to the WSL package's wsl.exe, which exists only once a WSL package is installed. */
export function packageDir(): string {
  return join(process.env.ProgramFiles ?? 'C:\\Program Files', 'WSL')
}

/** Path to the WSL package's wslc.exe, or undefined when the package doesn't have one. */
export function wslcPath(): string | undefined {
  const path = join(packageDir(), 'wslc.exe')
  return existsSync(path) ? path : undefined
}

/**
 * Runs the WSL package's wsl.exe. It runs by absolute path, because a bare `wsl` can resolve to
 * the inbox stub or a WindowsApps alias. stdin is closed so a prompt can't block, and WSL_UTF8
 * makes wsl.exe write UTF-8 rather than UTF-16LE.
 */
export async function wsl(args: string[], options: { silent?: boolean } = {}): Promise<WslResult> {
  const result = await getExecOutput(join(packageDir(), 'wsl.exe'), args, {
    env: { ...process.env, WSL_UTF8: '1' } as Record<string, string>,
    input: Buffer.alloc(0),
    ignoreReturnCode: true,
    silent: options.silent ?? false,
  })
  return { exitCode: result.exitCode, stdout: clean(result.stdout + result.stderr) }
}

/** Removes the NULs and carriage returns wsl.exe can leave in its output. */
export function clean(output: string): string {
  return output.replace(/\0/g, '').replace(/\r/g, '')
}

/** What `wsl --version` reports. */
export interface WslVersion {
  package: string
  kernel: string
}

/**
 * Parses `wsl --version`. The labels are translated on non-English systems, so this reads the
 * values by position: the first line is the package version and the second the kernel version.
 */
export function parseVersion(output: string): WslVersion | undefined {
  const values = clean(output)
    .split('\n')
    .map((line) => /:\s*(\d[\w.+-]*)\s*$/.exec(line)?.[1])
    .filter((value): value is string => value !== undefined)
  const [pkg, kernel] = values
  if (pkg === undefined || kernel === undefined || !/^\d+(\.\d+){1,3}$/.test(pkg)) {
    return undefined
  }
  return { package: pkg, kernel }
}

/** Returns the WSL error code in wsl.exe's output, such as `Wsl/Service/WSL_E_DISTRO_NOT_FOUND`. */
export function parseErrorCode(output: string): string | undefined {
  return /\bWsl\/[A-Za-z0-9_/]+/.exec(output)?.[0]
}
