import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { fetchProxyScrapeProxies } from '@/lib/proxyscrape'

// GET /api/proxies/proxyscrape — fetch free public proxies from ProxyScrape API
// Query params:
//   - protocol: http | socks4 | socks5 (default: http)
//   - limit: number (default: 50)
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const protocol = (url.searchParams.get('protocol') || 'http') as 'http' | 'socks4' | 'socks5'
  const limit = Math.min(100, Number(url.searchParams.get('limit')) || 50)

  const proxies = await fetchProxyScrapeProxies({ protocol, limit })

  return NextResponse.json({
    count: proxies.length,
    protocol,
    proxies,
    note: 'These are free public proxies. Quality varies — test before using for important jobs. For reliable scraping, use Webshare or another paid provider.',
  })
}
