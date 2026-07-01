import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { fullProxyTest } from '@/lib/proxy-test'
import { parseProxyList } from '@/lib/proxy'

// POST /api/proxies/test — test ALL proxies (batch)
// Body: { proxyConfigId?, proxies?, keepWorking? }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { proxyConfigId, proxies, keepWorking } = body as {
    proxyConfigId?: string; proxies?: string; keepWorking?: boolean
  }

  let proxyList: string[] = []
  let configId: string | undefined = proxyConfigId

  if (proxyConfigId) {
    const config = await db.proxyConfig.findUnique({ where: { id: proxyConfigId } })
    if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 404 })
    proxyList = config.proxies.split(/\r?\n/).filter(Boolean)
  } else if (proxies) {
    proxyList = parseProxyList(proxies).map((p) => p.raw)
  } else {
    return NextResponse.json({ error: 'proxyConfigId or proxies required' }, { status: 400 })
  }

  if (proxyList.length === 0) return NextResponse.json({ error: 'No proxies to test' }, { status: 400 })

  const results: Array<{ proxy: string; ok: boolean; exitIp?: string; error?: string; elapsedMs: number }> = []
  for (let i = 0; i < proxyList.length; i += 5) {
    const batch = proxyList.slice(i, i + 5)
    const batchResults = await Promise.all(batch.map((p) => fullProxyTest(p, 8000)))
    results.push(...batchResults)
  }

  const working = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)

  if (keepWorking && configId && working.length > 0) {
    await db.proxyConfig.update({
      where: { id: configId },
      data: { proxies: working.map((r) => r.proxy).join('\n') },
    })
  }

  return NextResponse.json({
    total: proxyList.length,
    working: working.length,
    failed: failed.length,
    results: results.map((r) => ({
      proxy: r.proxy.replace(/(:[^:@/]+)@/, ':****@'),
      ok: r.ok,
      exitIp: r.exitIp,
      error: r.error,
      elapsedMs: r.elapsedMs,
    })),
    updatedConfig: keepWorking && configId ? true : false,
  })
}
