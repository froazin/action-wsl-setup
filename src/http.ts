import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Fetches a URL, trying up to three times when the request fails or the server returns an
 * error, and giving each try 30 seconds. `what` names the thing being fetched in the error, such
 * as "the WSL release".
 */
export async function get(
  url: string,
  headers: Record<string, string>,
  what: string,
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) })
      if (response.status < 500 || attempt === 3) {
        return response
      }
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`Couldn't fetch ${what} from ${url}: ${describe(error)}`)
      }
    }
    await sleep(2000 * attempt)
  }
}

/** An error's message, with its cause, which holds the reason when fetch fails. */
function describe(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message
}
