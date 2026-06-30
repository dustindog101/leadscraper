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

// POST /api/jobs/[id] — update a job (cancel, pause, resume)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { action } = body as { action?: 'cancel' | 'pause' | 'resume' | 'retry' }

  const job = await db.searchJob.findUnique({ where: { id } })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'cancel') {
    if (['done', 'failed', 'cancelled'].includes(job.status)) {
      return NextResponse.json({ error: `Cannot cancel a ${job.status} job` }, { status: 400 })
    }
    const updated = await db.searchJob.update({
      where: { id },
      data: { status: 'cancelled', finishedAt: new Date() },
    })
    return NextResponse.json({ job: updated })
  }

  if (action === 'pause') {
    if (job.status !== 'running') {
      return NextResponse.json({ error: `Can only pause a running job (current: ${job.status})` }, { status: 400 })
    }
    const updated = await db.searchJob.update({
      where: { id },
      data: { status: 'paused' },
    })
    return NextResponse.json({ job: updated })
  }

  if (action === 'resume') {
    if (job.status !== 'paused') {
      return NextResponse.json({ error: `Can only resume a paused job (current: ${job.status})` }, { status: 400 })
    }
    const updated = await db.searchJob.update({
      where: { id },
      data: { status: 'running' },
    })
    return NextResponse.json({ job: updated })
  }

  if (action === 'retry') {
    if (!['failed', 'cancelled'].includes(job.status)) {
      return NextResponse.json({ error: `Can only retry a failed or cancelled job (current: ${job.status})` }, { status: 400 })
    }
    const updated = await db.searchJob.update({
      where: { id },
      data: {
        status: 'queued',
        progress: 0,
        errorMsg: null,
        startedAt: null,
        finishedAt: null,
      },
    })
    return NextResponse.json({ job: updated })
  }

  return NextResponse.json({ error: 'Unknown action. Use cancel, pause, resume, or retry.' }, { status: 400 })
}
