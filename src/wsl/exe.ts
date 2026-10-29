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
 *
 * The path is quoted because @actions/exec splits its first argument on spaces, and the path is
 * under `C:\Program Files`.
 */
export async function wsl(args: string[], options: { silent?: boolean } = {}): Promise<WslResult> {
  const result = await getExecOutput(`"${join(packageDir(), 'wsl.exe')}"`, args, {
    env: { ...process.env, WSL_UTF8: '1' } as Record<string, string>,
    input: Buffer.alloc(0),
    ignoreReturnCode: true,
    silent: options.silent ?? false,
  })
  return { exitCode: result.exitCode, stdout: clean(result.stdout + result.stderr) }
}

/**
 * Returns Windows' own architecture, `x64` or `arm64`. Node's process.arch is the architecture
 * Node was built for, which is x64 when an x64 runner runs under emulation on ARM64 Windows. The
 * registry holds the machine's architecture whatever process reads it. Falls back to
 * process.arch when the query fails.
 */
export async function nativeArch(): Promise<string> {
  const reg = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe')
  const key = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
  try {
    const result = await getExecOutput(`"${reg}"`, ['query', key, '/v', 'PROCESSOR_ARCHITECTURE'], {
      ignoreReturnCode: true,
      silent: true,
    })
    return parseArch(result.stdout) ?? process.arch
  } catch {
    return process.arch
  }
}

/** Reads PROCESSOR_ARCHITECTURE from `reg query` output as `x64` or `arm64`. */
export function parseArch(output: string): string | undefined {
  const value = /PROCESSOR_ARCHITECTURE\s+REG_SZ\s+(\S+)/i.exec(output)?.[1]?.toUpperCase()
  if (value === 'AMD64') return 'x64'
  if (value === 'ARM64') return 'arm64'
  return undefined
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
