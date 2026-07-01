import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { fullProxyTest } from '@/lib/proxy-test'
import { parseProxyList } from '@/lib/proxy'

// POST /api/proxies/test — lightweight proxy test (TCP + HTTP, no browser)
// Body: { proxies } — tests the FIRST proxy in the list
//
// This endpoint works on Vercel (no Chromium needed) — uses Node's net/http
// modules for a fast TCP connect test + HTTP CONNECT tunnel test.
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

  const proxy = list[0]
  const result = await fullProxyTest(proxy.raw, 8000)

  return NextResponse.json(result)
}
