import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/jobs/[id] — get a single job's current state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const job = await db.searchJob.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      proxyConfig: { select: { id: true, name: true } },
    },
  })

  if (!job) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ job })
}

// POST /api/jobs/[id] — update a job (cancel)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { action } = body as { action?: 'cancel' }

  if (action === 'cancel') {
    const job = await db.searchJob.findUnique({ where: { id } })
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
      return NextResponse.json({ error: `Cannot cancel a ${job.status} job` }, { status: 400 })
    }
    const updated = await db.searchJob.update({
      where: { id },
      data: { status: 'cancelled', finishedAt: new Date() },
    })
    return NextResponse.json({ job: updated })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
