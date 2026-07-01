/**
 * Lightweight proxy testing — TCP connect check.
 *
 * Before using a proxy for scraping, we do a quick TCP connect test
 * to verify the proxy is reachable. This takes <1 second per proxy
 * (vs 15+ seconds for a full page load test).
 *
 * We also check if the proxy returns HTTP 402 (bandwidth exceeded)
 * or HTTP 407 (auth failed) by making a tiny HTTP request.
 */

import * as net from 'net'
import * as http from 'http'
import * as https from 'https'
import { URL } from 'url'

export interface ProxyTestResult {
  proxy: string
  ok: boolean
  exitIp?: string
  error?: string
  elapsedMs: number
}

/**
 * Quick TCP connect test — verifies the proxy server is reachable.
 * Takes <1 second. Does NOT load any web page.
 */
export function quickProxyTest(proxyUrl: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL(proxyUrl)
      const host = url.hostname
      const port = parseInt(url.port || '8080', 10)

      const socket = new net.Socket()
      socket.setTimeout(timeoutMs)

      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })

      socket.on('timeout', () => {
        socket.destroy()
        resolve(false)
      })

      socket.on('error', () => {
        socket.destroy()
        resolve(false)
      })

      socket.connect(port, host)
    } catch {
      resolve(false)
    }
  })
}

/**
 * Full proxy test — TCP connect + HTTP request through the proxy.
 * Returns exit IP if the proxy works, or the error message if not.
 *
 * Uses Node's http/https module with the proxy option (available in Node 18+).
 */
export async function fullProxyTest(
  proxyUrl: string,
  timeoutMs = 8000
): Promise<ProxyTestResult> {
  const t0 = Date.now()

  // Step 1: Quick TCP test first (fast fail for dead proxies)
  const tcpOk = await quickProxyTest(proxyUrl, 3000)
  if (!tcpOk) {
    return {
      proxy: proxyUrl,
      ok: false,
      error: 'TCP connect failed — proxy server is unreachable',
      elapsedMs: Date.now() - t0,
    }
  }

  // Step 2: Try an HTTP request through the proxy
  try {
    const url = new URL(proxyUrl)
    const proxyHost = url.hostname
    const proxyPort = parseInt(url.port || '8080', 10)
    const proxyAuth = url.username
      ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
      : undefined

    // Use http.request with CONNECT method to test HTTPS proxying
    const result = await new Promise<ProxyTestResult>((resolve) => {
      const req = http.request({
        host: proxyHost,
        port: proxyPort,
        method: 'CONNECT',
        path: 'api.ipify.org:443',
        headers: proxyAuth
          ? { 'Proxy-Authorization': `Basic ${Buffer.from(proxyAuth).toString('base64')}` }
          : {},
        timeout: timeoutMs,
      })

      req.on('connect', (_res, socket) => {
        // CONNECT succeeded — now do a quick HTTPS request through the tunnel
        const httpsReq = https.request(
          {
            host: 'api.ipify.org',
            path: '/?format=json',
            method: 'GET',
            socket: socket,
            agent: false,
            timeout: 5000,
          },
          (httpsRes) => {
            let body = ''
            httpsRes.on('data', (chunk) => (body += chunk))
            httpsRes.on('end', () => {
              const elapsed = Date.now() - t0
              try {
                const data = JSON.parse(body)
                resolve({
                  proxy: proxyUrl,
                  ok: true,
                  exitIp: data.ip,
                  elapsedMs: elapsed,
                })
              } catch {
                // Got a response but not JSON — might be bandwidth error
                if (body.includes('Bandwidth limit reached')) {
                  resolve({
                    proxy: proxyUrl,
                    ok: false,
                    error: 'Bandwidth limit reached (Webshare free tier exhausted)',
                    elapsedMs: elapsed,
                  })
                } else {
                  resolve({
                    proxy: proxyUrl,
                    ok: false,
                    error: `Unexpected response: ${body.slice(0, 100)}`,
                    elapsedMs: elapsed,
                  })
                }
              }
            })
          }
        )

        httpsReq.on('error', (e) => {
          resolve({
            proxy: proxyUrl,
            ok: false,
            error: e.message,
            elapsedMs: Date.now() - t0,
          })
        })

        httpsReq.on('timeout', () => {
          httpsReq.destroy()
          resolve({
            proxy: proxyUrl,
            ok: false,
            error: 'HTTPS request timeout',
            elapsedMs: Date.now() - t0,
          })
        })

        httpsReq.end()
      })

      req.on('response', (res) => {
        // Non-CONNECT response — likely an error
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode === 407) {
            resolve({
              proxy: proxyUrl,
              ok: false,
              error: 'Authentication failed (407)',
              elapsedMs: Date.now() - t0,
            })
          } else if (res.statusCode === 402) {
            resolve({
              proxy: proxyUrl,
              ok: false,
              error: 'Bandwidth limit reached (402)',
              elapsedMs: Date.now() - t0,
            })
          } else {
            resolve({
              proxy: proxyUrl,
              ok: false,
              error: `HTTP ${res.statusCode}: ${body.slice(0, 100)}`,
              elapsedMs: Date.now() - t0,
            })
          }
        })
      })

      req.on('error', (e) => {
        resolve({
          proxy: proxyUrl,
          ok: false,
          error: e.message,
          elapsedMs: Date.now() - t0,
        })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({
          proxy: proxyUrl,
          ok: false,
          error: 'CONNECT timeout',
          elapsedMs: Date.now() - t0,
        })
      })

      req.end()
    })

    return result
  } catch (e) {
    return {
      proxy: proxyUrl,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      elapsedMs: Date.now() - t0,
    }
  }
}

/**
 * Test multiple proxies and return only the working ones.
 * Runs tests in parallel for speed.
 */
export async function testMultipleProxies(
  proxies: string[],
  maxConcurrent = 5
): Promise<{ working: string[]; failed: Array<{ proxy: string; error: string }> }> {
  const working: string[] = []
  const failed: Array<{ proxy: string; error: string }> = []

  for (let i = 0; i < proxies.length; i += maxConcurrent) {
    const batch = proxies.slice(i, i + maxConcurrent)
    const results = await Promise.all(batch.map((p) => fullProxyTest(p)))

    for (const result of results) {
      if (result.ok) {
        working.push(result.proxy)
      } else {
        failed.push({ proxy: result.proxy, error: result.error || 'unknown error' })
      }
    }
  }

  return { working, failed }
}
