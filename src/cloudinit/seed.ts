import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import * as core from '@actions/core'

/** The user-data and meta-data for an instance's first boot. */
export interface Seed {
  userData: string
  metaData: string
}

/** The state that records the seed files the action writes, for the post step to remove. */
export const SEED_STATE = 'seed-files'

/** The directory cloud-init's WSL datasource reads seed files from. */
export function seedDir(): string {
  return join(process.env.USERPROFILE ?? homedir(), '.cloud-init')
}

/**
 * Reads a seed file as cloud-init needs it: without a byte order mark and with LF line endings.
 * A checkout on Windows can give the file CRLF line endings.
 */
export function normalise(content: string): string {
  return content.replace(/^﻿/, '').replace(/\r\n/g, '\n')
}

/** Resolves a path input against the workspace and reads it, failing if it doesn't exist. */
export function readInputFile(path: string, input: string): string {
  const full = isAbsolute(path) ? path : resolve(process.env.GITHUB_WORKSPACE ?? '.', path)
  if (!existsSync(full)) {
    throw new Error(`${input} is ${path}, but ${full} doesn't exist.`)
  }
  return normalise(readFileSync(full, 'utf8'))
}

/**
 * Builds the seed from the inputs. Without meta-data, the datasource still needs an instance-id,
 * so the seed gets one named after the instance.
 */
export function buildSeed(instance: string, userData: string, metaData?: string): Seed {
  return { userData, metaData: metaData ?? `instance-id: ${instance}\n` }
}

/**
 * Writes the seed files for an instance, and returns a function that removes the ones it wrote.
 * A seed file that's already there with other content is someone else's, so it fails rather than
 * replace it. One with the same content is left in place, and left behind afterwards.
 *
 * It records the files in SEED_STATE before writing them, so the post step can remove them when
 * the job is cancelled or times out before the returned function runs.
 */
export function placeSeed(instance: string, seed: Seed): () => void {
  const dir = seedDir()
  const files = [
    { path: join(dir, `${instance}.user-data`), content: seed.userData },
    { path: join(dir, `${instance}.meta-data`), content: seed.metaData },
  ]
  for (const file of files) {
    if (existsSync(file.path) && normalise(readFileSync(file.path, 'utf8')) !== file.content) {
      throw new Error(
        `${file.path} already exists with other content, and the action won't replace it. Remove it, or set instance-name to another name.`,
      )
    }
  }
  mkdirSync(dir, { recursive: true })
  const written = files.filter((file) => !existsSync(file.path)).map((file) => file.path)
  core.saveState(SEED_STATE, JSON.stringify(written))
  const remove = () => removeFiles(written)
  try {
    for (const file of files.filter((file) => written.includes(file.path))) {
      writeFileSync(file.path, file.content)
      core.info(`Wrote ${file.path}`)
    }
  } catch (error) {
    remove()
    throw error
  }
  return remove
}

/** Removes the seed files recorded in SEED_STATE. The post step runs it. */
export function removeSavedSeed(): void {
  const saved = core.getState(SEED_STATE)
  removeFiles(saved ? (JSON.parse(saved) as string[]) : [])
}

function removeFiles(paths: string[]): void {
  for (const path of paths) {
    if (existsSync(path)) {
      rmSync(path, { force: true })
      core.info(`Removed ${path}`)
    }
  }
}
