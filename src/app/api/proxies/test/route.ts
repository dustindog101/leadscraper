import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { parseProxyList } from '@/lib/proxy'

// POST /api/proxies/test — test a proxy by loading a page through it
// Body: { proxies } — tests the FIRST proxy in the list
//
// NOTE: This endpoint requires Patchright/Chromium to be installed.
// On Vercel serverless functions, Chromium is NOT available, so this
// endpoint returns a clear error message directing the user to test
// on the worker (Railway) or locally. The proxy test only works where
// a browser binary exists.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { proxies } = body as { proxies?: string }

  if (!proxies) {
    return NextResponse.json({ error: 'proxies is required' }, { status: 400 })
  }

  const list = parseProxyList(proxies)
  if (list.length === 0) {
    return NextResponse.json({ error: 'No valid proxy entries' }, { status: 400 })
  }

  // On Vercel, we can't run Patchright (no Chromium binary, 300s timeout).
  // Return a helpful error message instead of crashing.
  if (process.env.VERCEL) {
    return NextResponse.json({
      ok: false,
      error:
        'Proxy testing is not available on Vercel (no browser binary). ' +
        'Run this test from your local machine or the Railway worker. ' +
        'See HOSTING.md for setup instructions.',
      proxy: list[0].server,
    }, { status: 200 }) // 200 so the UI shows the message, not a generic error
  }

  // Local/worker: actually test the proxy
  const { chromium } = await import('patchright')
  const proxy = list[0]
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })
    const context = await browser.newContext({
      proxy: {
        server: proxy.server,
        username: proxy.username,
        password: proxy.password,
      },
    })
    const page = await context.newPage()
    page.setDefaultNavigationTimeout(20_000)

    const t0 = Date.now()
    const response = await page.goto('https://api.ipify.org?format=json', {
      waitUntil: 'domcontentloaded',
    })
    const elapsed = Date.now() - t0

    if (!response || !response.ok()) {
      await browser.close().catch(() => {})
      return NextResponse.json({
        ok: false,
        error: `Proxy returned status ${response?.status() ?? 'unknown'}`,
        proxy: proxy.server,
      })
    }

    const bodyText = await page.content()
    const ipMatch = bodyText.match(/"ip":\s*"([^"]+)"/)
    const ip = ipMatch ? ipMatch[1] : 'unknown'

    await context.close()
    await browser.close()

    return NextResponse.json({
      ok: true,
      proxy: proxy.server,
      exitIp: ip,
      elapsedMs: elapsed,
    })
  } catch (e) {
    if (browser) await browser.close().catch(() => {})
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({
      ok: false,
      proxy: proxy.server,
      error: msg,
    })
  }
}
