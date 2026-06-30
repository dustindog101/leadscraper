import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { db } from '@/lib/db'

// GET /api/tags — list all tags
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tags = await db.tag.findMany({
    include: { _count: { select: { leads: true } } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json({ tags })
}

// DELETE /api/tags — delete a tag (by query param)
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 })
  await db.tag.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
