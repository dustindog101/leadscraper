import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// POST /api/leads/tag — apply or remove a tag from a lead
// Body: { leadId, tagName, action: 'add' | 'remove' }
// Tags are auto-created if they don't exist.
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { leadId, tagName, action } = body as {
    leadId?: string
    tagName?: string
    action?: 'add' | 'remove'
  }

  if (!leadId || !tagName || !action) {
    return NextResponse.json(
      { error: 'leadId, tagName, and action are required' },
      { status: 400 }
    )
  }

  const lead = await db.lead.findUnique({ where: { id: leadId } })
  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  if (action === 'add') {
    const tag = await db.tag.upsert({
      where: { name: tagName },
      create: { name: tagName },
      update: {},
    })
    await db.leadTag.upsert({
      where: {
        leadId_tagId_userId: { leadId, tagId: tag.id, userId: session.user.id },
      },
      create: { leadId, tagId: tag.id, userId: session.user.id },
      update: {},
    })
    return NextResponse.json({ ok: true, tagId: tag.id })
  }

  // remove — only removes the current user's tag, not other users'
  const tag = await db.tag.findUnique({ where: { name: tagName } })
  if (!tag) return NextResponse.json({ ok: true })
  await db.leadTag.deleteMany({
    where: { leadId, tagId: tag.id, userId: session.user.id },
  })
  return NextResponse.json({ ok: true })
}
