import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'
import { describeProxyCount, parseProxyList } from '@/lib/proxy'
import { Prisma } from '@prisma/client'

// GET /api/proxies — list all proxy configs
// Per user request: all team members see full proxy credentials (no masking)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const configs = await db.proxyConfig.findMany({
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    configs: configs.map((c) => ({
      ...c,
      proxyCount: parseProxyList(c.proxies).length,
      proxyDescription: describeProxyCount(c.proxies),
      // Full proxy list visible to all team members (per user's choice)
      proxiesList: c.proxies.split(/\r?\n/).filter(Boolean),
    })),
  })
}

// POST /api/proxies — create a new proxy config
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { name, type, proxies, rotateMode, enabled } = body as {
    name?: string
    type?: string
    proxies?: string
    rotateMode?: string
    enabled?: boolean
  }

  if (!name || !type || !proxies) {
    return NextResponse.json(
      { error: 'name, type, and proxies are required' },
      { status: 400 }
    )
  }

  if (!['http', 'socks5', 'socks4'].includes(type)) {
    return NextResponse.json(
      { error: 'type must be http, socks5, or socks4' },
      { status: 400 }
    )
  }

  const parsed = parseProxyList(proxies)
  if (parsed.length === 0) {
    return NextResponse.json(
      { error: 'No valid proxy entries found. Check format.' },
      { status: 400 }
    )
  }

  const config = await db.proxyConfig.create({
    data: {
      name: name.trim(),
      type,
      proxies: proxies.trim(),
      rotateMode: rotateMode === 'random' ? 'random' : 'round-robin',
      enabled: enabled !== false,
    },
  })

  return NextResponse.json({
    config: {
      ...config,
      proxyCount: parsed.length,
      proxyDescription: describeProxyCount(config.proxies),
      proxiesList: config.proxies.split(/\r?\n/).filter(Boolean),
    },
  })
}
