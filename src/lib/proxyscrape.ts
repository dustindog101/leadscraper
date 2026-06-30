/**
 * ProxyScrape API integration — fetches free public proxies.
 *
 * ProxyScrape provides free proxy lists via their API:
 *   https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all
 *
 * These are lower quality than Webshare residential proxies (no auth, less reliable),
 * but they're FREE and unlimited. Useful as a fallback when Webshare bandwidth is exhausted.
 *
 * Usage:
 *   import { fetchProxyScrapeProxies } from './proxyscrape'
 *   const proxies = await fetchProxyScrapeProxies()
 *   // → ["http://1.2.3.4:8080", "http://5.6.7.8:3128", ...]
 */

const PROXYSCRAPE_URL = 'https://api.proxyscrape.com/v2/'

export interface ProxyScrapeOptions {
  protocol?: 'http' | 'socks4' | 'socks5'
  timeout?: number  // minimum timeout in ms (filters slow proxies)
  country?: string  // country code, e.g. 'US' or 'all'
  ssl?: 'all' | 'yes' | 'no'
  anonymity?: 'all' | 'anonymous' | 'elite'
  limit?: number  // max proxies to return
}

/**
 * Fetch free public proxies from ProxyScrape API.
 * Returns array of proxy URLs ready to use with Playwright/Patchright.
 */
export async function fetchProxyScrapeProxies(
  opts: ProxyScrapeOptions = {}
): Promise<string[]> {
  const {
    protocol = 'http',
    timeout = 5000,
    country = 'all',
    ssl = 'all',
    anonymity = 'all',
    limit = 50,
  } = opts

  const params = new URLSearchParams({
    request: 'displayproxies',
    protocol,
    timeout: String(timeout),
    country,
    ssl,
    anonymity,
  })

  const url = `${PROXYSCRAPE_URL}?${params.toString()}`

  try {
    const controller = new AbortController()
    const abortTimeout = setTimeout(() => controller.abort(), 10000)

    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(abortTimeout)

    if (!res.ok) {
      console.error(`[proxyscrape] API error: ${res.status} ${res.statusText}`)
      return []
    }

    const text = await res.text()
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

    // Convert "host:port" to "http://host:port"
    const proxies = lines.map((line) => {
      if (line.startsWith('http://') || line.startsWith('socks')) return line
      return `${protocol}://${line}`
    })

    console.log(`[proxyscrape] fetched ${proxies.length} ${protocol} proxies`)
    return proxies.slice(0, limit)
  } catch (e) {
    console.error('[proxyscrape] fetch failed:', e instanceof Error ? e.message : String(e))
    return []
  }
}

/**
 * Test a list of proxies and return only the working ones.
 * Tests each proxy by trying to load a page through it.
 */
export async function testProxies(
  proxies: string[],
  maxConcurrent: number = 10
): Promise<string[]> {
  const working: string[] = []

  // Test in batches to avoid overwhelming
  for (let i = 0; i < proxies.length; i += maxConcurrent) {
    const batch = proxies.slice(i, i + maxConcurrent)
    const results = await Promise.allSettled(
      batch.map(async (proxy) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000)

        const res = await fetch('https://api.ipify.org?format=json', {
          proxy: proxy as any,  // Node fetch supports proxy option
          signal: controller.signal,
        })
        clearTimeout(timeout)

        if (res.ok) return proxy
        throw new Error('proxy failed')
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') working.push(result.value)
    }
  }

  console.log(`[proxyscrape] ${working.length}/${proxies.length} proxies working`)
  return working
}
