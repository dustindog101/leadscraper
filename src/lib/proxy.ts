/**
 * Proxy rotation helper.
 *
 * Supports:
 *   - Single proxy: "http://user:pass@host:port" or "socks5://host:port"
 *   - Multiple proxies: newline-separated list, rotated round-robin or random
 *
 * Each proxy is parsed into the form Playwright expects:
 *   { server: "http://host:port", username?: "user", password?: "pass" }
 */

export type ProxyProtocol = 'http' | 'socks5' | 'socks4' | 'https'

export interface ParsedProxy {
  server: string // Full URL e.g. "http://1.2.3.4:8080" or "socks5://1.2.3.4:1080"
  username?: string
  password?: string
  raw: string
}

export type RotateMode = 'round-robin' | 'random'

export class ProxyRotator {
  private proxies: ParsedProxy[] = []
  private index = 0
  public readonly mode: RotateMode

  constructor(proxyList: string, mode: RotateMode = 'round-robin') {
    this.mode = mode
    this.proxies = parseProxyList(proxyList)
  }

  get count() {
    return this.proxies.length
  }

  get hasProxies() {
    return this.proxies.length > 0
  }

  next(): ParsedProxy | null {
    if (this.proxies.length === 0) return null
    if (this.mode === 'random') {
      return this.proxies[Math.floor(Math.random() * this.proxies.length)]
    }
    // round-robin
    const proxy = this.proxies[this.index % this.proxies.length]
    this.index = (this.index + 1) % this.proxies.length
    return proxy
  }

  /** Mark a proxy as bad — remove it from rotation. */
  markBad(proxy: ParsedProxy) {
    this.proxies = this.proxies.filter((p) => p.raw !== proxy.raw)
  }
}

export function parseProxyList(input: string): ParsedProxy[] {
  if (!input) return []
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseProxyLine)
    .filter((p): p is ParsedProxy => p !== null)
}

/**
 * Accepts many input formats:
 *   - "http://user:pass@host:port"
 *   - "socks5://host:port"
 *   - "host:port:user:pass"     (legacy)
 *   - "host:port"               (assumes http)
 *   - "user:pass@host:port"     (assumes http)
 */
export function parseProxyLine(line: string): ParsedProxy | null {
  if (!line || line.startsWith('#')) return null

  // Already a URL?
  const urlMatch = line.match(/^(https?|socks[45]):\/\/(?:([^:@/]+):([^@/]+)@)?([^:/]+):(\d+)$/)
  if (urlMatch) {
    const [, protocol, user, pass, host, port] = urlMatch
    return {
      server: `${protocol}://${host}:${port}`,
      username: user ? decodeURIComponent(user) : undefined,
      password: pass ? decodeURIComponent(pass) : undefined,
      raw: line,
    }
  }

  // user:pass@host:port (no protocol)
  const authMatch = line.match(/^([^:@/]+):([^@/]+)@([^:/]+):(\d+)$/)
  if (authMatch) {
    const [, user, pass, host, port] = authMatch
    return {
      server: `http://${host}:${port}`,
      username: user,
      password: pass,
      raw: line,
    }
  }

  // host:port:user:pass (legacy gosom format)
  const legacy4 = line.match(/^([^:/]+):(\d+):([^:/]+):([^:/]+)$/)
  if (legacy4) {
    const [, host, port, user, pass] = legacy4
    return {
      server: `http://${host}:${port}`,
      username: user,
      password: pass,
      raw: line,
    }
  }

  // host:port
  const simple = line.match(/^([^:/]+):(\d+)$/)
  if (simple) {
    const [, host, port] = simple
    return {
      server: `http://${host}:${port}`,
      raw: line,
    }
  }

  console.warn(`[proxy] could not parse line: ${line}`)
  return null
}

export function describeProxyCount(proxyList: string): string {
  const parsed = parseProxyList(proxyList)
  if (parsed.length === 0) return 'no proxies'
  if (parsed.length === 1) return '1 proxy'
  return `${parsed.length} proxies`
}
