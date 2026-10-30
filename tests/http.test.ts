import { afterEach, describe, expect, it, vi } from 'vitest'
import { get } from '../src/http.js'

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async () => undefined) }))

/** A Response as fetch gives it after following a redirect. */
function redirectedTo(url: string): Response {
  const response = new Response('{}')
  Object.defineProperty(response, 'redirected', { value: true })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('get', () => {
  it('returns a response the server answered', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    await expect(get('https://example.com', {}, 'a thing')).resolves.toHaveProperty('status', 404)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('tries a server error three times', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    await expect(get('https://example.com', {}, 'a thing')).resolves.toHaveProperty('status', 503)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('fails with the cause after three failed requests', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') })
    })
    vi.stubGlobal('fetch', fetch)
    await expect(get('https://example.com', {}, 'a thing')).rejects.toThrow(
      "Couldn't fetch a thing from https://example.com: fetch failed: ECONNRESET",
    )
  })

  it('follows a redirect to https', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => redirectedTo('https://cdn.example.com/x')),
    )
    await expect(get('https://example.com', {}, 'a thing')).resolves.toBeInstanceOf(Response)
  })

  it('refuses a redirect from https to http, without retrying', async () => {
    const fetch = vi.fn(async () => redirectedTo('http://cdn.example.com/x'))
    vi.stubGlobal('fetch', fetch)
    await expect(get('https://example.com', {}, 'a thing')).rejects.toThrow(
      'redirected to http://cdn.example.com/x, not https',
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
