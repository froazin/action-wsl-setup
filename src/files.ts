import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/** Resolves a path input against the workspace, failing unless it's a file that exists. */
export function resolveInputPath(path: string, input: string): string {
  const full = isAbsolute(path) ? path : resolve(process.env.GITHUB_WORKSPACE ?? '.', path)
  const stat = statSync(full, { throwIfNoEntry: false })
  if (!stat) {
    throw new Error(`${input} is ${path}, but ${full} doesn't exist.`)
  }
  if (!stat.isFile()) {
    throw new Error(`${input} is ${path}, but ${full} isn't a file.`)
  }
  return full
}
