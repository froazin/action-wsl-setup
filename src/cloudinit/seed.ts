import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import * as core from '@actions/core'

/** The user-data and meta-data for an instance's first boot. */
export interface Seed {
  userData: string
  metaData: string
}

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
  const written = files.filter((file) => !existsSync(file.path))
  for (const file of written) {
    writeFileSync(file.path, file.content)
    core.info(`Wrote ${file.path}`)
  }
  return () => {
    for (const file of written) {
      rmSync(file.path, { force: true })
    }
  }
}
