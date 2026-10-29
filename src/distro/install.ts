import { parseErrorCode, wsl } from '../wsl/exe.js'

/** The WSL version of an instance: 1 runs Linux on Windows' own kernel, 2 in a virtual machine. */
export type InstanceVersion = 1 | 2

/** One line of `wsl --list --verbose`. */
export interface Instance {
  name: string
  version: number
}

/** Error codes that mean the runner can't run a virtual machine for WSL 2. */
const NO_VIRTUALISATION = [
  'HCS_E_HYPERV_NOT_INSTALLED',
  'WSL_E_VIRTUAL_MACHINE_PLATFORM_REQUIRED',
  'WSL_E_VM_MODE_NOT_SUPPORTED',
  'WSL_E_WSL2_NEEDED',
]

/** Parses the `wsl-version` input. Empty means 2. */
export function parseWslVersion(input: string): InstanceVersion {
  const value = input.trim()
  if (value === '' || value === '2') return 2
  if (value === '1') return 1
  throw new Error(`wsl-version must be 1 or 2, not "${value}".`)
}

/** Checks an instance name is one wsl.exe accepts. */
export function checkInstanceName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(
      `"${name}" isn't a valid instance name. Use letters, digits, ".", "_" and "-", starting with a letter or digit.`,
    )
  }
}

/**
 * Parses `wsl --list --verbose`. The header is translated on non-English Windows, so this keeps
 * the lines that end in a WSL version, and reads the name from the first column.
 */
export function parseInstances(output: string): Instance[] {
  return output
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*\*/, '')
        .trim()
        .split(/\s+/),
    )
    .filter((columns) => columns.length >= 3 && /^[12]$/.test(columns.at(-1) ?? ''))
    .map((columns) => ({ name: columns[0] ?? '', version: Number(columns.at(-1)) }))
}

/** Lists the instances registered with WSL. With none, wsl.exe fails, so that's an empty list. */
export async function listInstances(): Promise<Instance[]> {
  return parseInstances((await wsl(['--list', '--verbose'], { silent: true })).stdout)
}

/** Explains why `wsl --install` failed, in terms of what the workflow can change. */
export function explainInstallError(
  output: string,
  name: string,
  version: InstanceVersion,
): string {
  const code = parseErrorCode(output)
  if (version === 2 && code && NO_VIRTUALISATION.some((symbol) => code.endsWith(symbol))) {
    return `WSL 2 can't start on this runner because it has no virtualisation for WSL 2's virtual machine (${code}). Set wsl-version to 1 to install ${name} as a WSL 1 instance.`
  }
  return `wsl.exe couldn't install ${name}${code ? ` (${code})` : ''}. Its output is above.`
}

/** Installs an image as a new instance, without starting it, and checks its WSL version. */
export async function installImage(
  name: string,
  path: string,
  version: InstanceVersion,
): Promise<void> {
  const args = ['--install', '--from-file', path, '--name', name, '--version', String(version)]
  const result = await wsl([...args, '--no-launch'])
  if (result.exitCode !== 0) {
    throw new Error(explainInstallError(result.stdout, name, version))
  }
  const instance = (await listInstances()).find((i) => i.name.toLowerCase() === name.toLowerCase())
  if (!instance) {
    throw new Error(`wsl.exe installed ${name}, but it isn't in wsl --list.`)
  }
  if (instance.version !== version) {
    throw new Error(`${name} installed as WSL ${instance.version}, not WSL ${version}.`)
  }
}
