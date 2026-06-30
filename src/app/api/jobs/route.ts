import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// POST /api/jobs — create a new scrape job
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { query, location, maxResults, useProxy, proxyConfigId } = body as {
    query?: string
    location?: string
    maxResults?: number
    useProxy?: boolean
    proxyConfigId?: string
  }

  if (!query || !location) {
    return NextResponse.json(
      { error: 'query and location are required' },
      { status: 400 }
    )
  }

  const cappedMax = Math.min(Math.max(5, Number(maxResults) || 200), 10000)

  // If proxy requested, validate config exists
  if (useProxy && proxyConfigId) {
    const cfg = await db.proxyConfig.findUnique({ where: { id: proxyConfigId } })
    if (!cfg) {
      return NextResponse.json({ error: 'Proxy config not found' }, { status: 400 })
    }
  }

  const job = await db.searchJob.create({
    data: {
      query: query.trim(),
      location: location.trim(),
      maxResults: cappedMax,
      useProxy: !!useProxy,
      proxyConfigId: useProxy ? proxyConfigId : null,
      userId: session.user.id,
      status: 'queued',
    },
  })

  // In local dev (or self-hosted), run the scraper inline in the API route.
  // In production on Vercel, the worker (Railway/Render) polls the DB for
  // queued jobs and runs them — Vercel functions time out at 300s and
  // can't run Playwright.
  //
  // We detect "local mode" via the presence of a RUN_WORKER_INLINE env var
  // OR the absence of VERCEL env var.
  const isLocal = !process.env.VERCEL && process.env.RUN_WORKER_INLINE !== 'false'

  if (isLocal) {
    const { runSearchJob } = await import('@/lib/job-runner')
    runSearchJob(job.id).catch((e) => {
      console.error(`[jobs] runSearchJob failed for ${job.id}:`, e)
    })
  }

  return NextResponse.json({ job }, { status: 201 })
}

// GET /api/jobs — list jobs for current user
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const limit = Math.min(50, Number(url.searchParams.get('limit')) || 20)

  const jobs = await db.searchJob.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  })

  return NextResponse.json({ jobs })
}
