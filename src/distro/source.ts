import { resolveInputPath } from '../files.js'
import { parseOciReference } from './oci.js'

/** Where the `image` input says to get a distribution image from. */
export type ImageSource =
  | { kind: 'url'; url: string; sha256?: string }
  | { kind: 'oci'; reference: string }
  | { kind: 'file'; path: string; sha256?: string }

/**
 * Parses the `image` and `image-sha256` inputs. An `https://` URL or a file is checked against
 * the SHA-256 when one is given, and used unchecked when not. An `oci://` reference is checked
 * against the digests its registry lists. Anything else is a path to a file, relative to the
 * workspace.
 */
export function parseImageSource(input: string, sha256Input: string): ImageSource | undefined {
  const value = input.trim()
  const sha256 = parseSha256(sha256Input)
  if (value === '') {
    if (sha256) {
      throw new Error('image-sha256 needs image as well.')
    }
    return undefined
  }
  if (/^http:\/\//i.test(value)) {
    throw new Error(`image must use https, not ${value}.`)
  }
  if (/^https:\/\//i.test(value)) {
    return { kind: 'url', url: value, sha256 }
  }
  if (/^oci:\/\//i.test(value)) {
    if (sha256) {
      throw new Error(
        "image-sha256 doesn't apply to an oci:// image, which is checked against its registry's digests. Pin it with @sha256:<digest> instead.",
      )
    }
    const reference = value.slice('oci://'.length)
    // Checked now, so a typo fails before anything changes on the runner.
    parseOciReference(reference)
    return { kind: 'oci', reference }
  }
  return { kind: 'file', path: resolveInputPath(value, 'image'), sha256 }
}

/** Parses a SHA-256 in hex, with or without a `sha256:` prefix. Empty means none. */
export function parseSha256(input: string): string | undefined {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '')
  if (value === '') {
    return undefined
  }
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`image-sha256 must be 64 hexadecimal characters, not "${input.trim()}".`)
  }
  return value
}
