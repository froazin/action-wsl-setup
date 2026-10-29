import { existsSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** Resolves a path input against the workspace, failing if the file doesn't exist. */
export function resolveInputPath(path: string, input: string): string {
  const full = isAbsolute(path) ? path : resolve(process.env.GITHUB_WORKSPACE ?? '.', path)
  if (!existsSync(full)) {
    throw new Error(`${input} is ${path}, but ${full} doesn't exist.`)
  }
  return full
}
