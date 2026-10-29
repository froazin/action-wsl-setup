import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

/** Returns a file's SHA-256 as lowercase hex. */
export async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}
